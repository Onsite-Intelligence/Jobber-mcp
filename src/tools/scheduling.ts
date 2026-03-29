/**
 * MCP tools for Jobber scheduling and calendar operations.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  jobberRequest,
  GET_SCHEDULE,
  CREATE_VISIT,
  LIST_USERS,
} from "../graphql/queries.js";
import { extractUserErrors, formatErrorForMCP } from "../utils/errors.js";
import { fetchAllPages } from "../utils/pagination.js";

interface Visit {
  startAt: string;
  endAt: string;
  assignedUsers?: { nodes: Array<{ id: string; name: { full: string } }> };
}

interface ScheduleJob {
  visits?: { nodes: Visit[] };
}

export function registerSchedulingTools(server: McpServer): void {
  // ── Get Schedule ─────────────────────────────────────────────────
  server.tool(
    "jobber_get_schedule",
    "Get the schedule of jobs and visits for a date range. Shows what's booked, who's assigned, and when. Essential for checking availability before booking new work.",
    {
      start_date: z
        .string()
        .describe("Start date in ISO 8601 format (YYYY-MM-DD). E.g. '2026-03-28'."),
      end_date: z
        .string()
        .describe("End date in ISO 8601 format (YYYY-MM-DD). E.g. '2026-04-04'."),
      team_member_name: z
        .string()
        .optional()
        .describe(
          "Filter by team member name (partial match). Only shows visits assigned to this person."
        ),
      limit: z
        .number()
        .min(1)
        .max(50)
        .default(50)
        .describe("Maximum number of jobs to return. Default 50."),
    },
    async ({ start_date, end_date, team_member_name, limit }) => {
      try {
        const data = await jobberRequest(GET_SCHEDULE, {
          startAt: start_date,
          endAt: end_date,
          first: limit,
        });

        let jobs = ((data.jobs as Record<string, unknown>)?.nodes ?? []) as Array<Record<string, unknown>>;

        // Filter by team member if specified
        if (team_member_name) {
          const nameFilter = team_member_name.toLowerCase();
          jobs = jobs.filter((job) => {
            const visits = (job.visits as { nodes: Visit[] })?.nodes ?? [];
            return visits.some((v) =>
              v.assignedUsers?.nodes?.some((u) =>
                u.name.full.toLowerCase().includes(nameFilter)
              )
            );
          });
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  date_range: { start: start_date, end: end_date },
                  total_jobs: jobs.length,
                  jobs,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return formatErrorForMCP(error);
      }
    }
  );

  // ── Create Visit ─────────────────────────────────────────────────
  server.tool(
    "jobber_create_visit",
    "Schedule a visit (appointment) for an existing job. A visit is a specific time slot when a team member goes to do the work. The job must already exist — create it first with jobber_create_job.",
    {
      job_id: z.string().describe("The Jobber job ID to schedule the visit for"),
      start_at: z
        .string()
        .describe(
          "Visit start time in ISO 8601 datetime format (e.g. '2026-03-28T09:00:00-04:00'). Include timezone offset."
        ),
      end_at: z
        .string()
        .describe(
          "Visit end time in ISO 8601 datetime format (e.g. '2026-03-28T11:00:00-04:00'). Include timezone offset."
        ),
      team_member_ids: z
        .array(z.string())
        .optional()
        .describe(
          "Array of Jobber user IDs to assign to this visit. Get IDs from jobber_get_availability. Omit to leave unassigned."
        ),
      instructions: z
        .string()
        .optional()
        .describe("Special instructions for this visit (shown to the assigned team member)"),
    },
    async ({ job_id, start_at, end_at, team_member_ids, instructions }) => {
      try {
        const input: Record<string, unknown> = {
          jobId: job_id,
          startAt: start_at,
          endAt: end_at,
        };
        if (team_member_ids && team_member_ids.length > 0) {
          input.assignedEntityIds = team_member_ids;
        }
        if (instructions) {
          input.instructions = instructions;
        }

        const data = await jobberRequest(CREATE_VISIT, { input });
        const result = data.visitCreate as Record<string, unknown>;
        const userErr = extractUserErrors(result);
        if (userErr) {
          return {
            content: [
              { type: "text" as const, text: `Failed to create visit: ${userErr}` },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result.visit, null, 2),
            },
          ],
        };
      } catch (error) {
        return formatErrorForMCP(error);
      }
    }
  );

  // ── Get Availability ─────────────────────────────────────────────
  server.tool(
    "jobber_get_availability",
    "Check available time slots for team members on a given date range. This derives availability by fetching the existing schedule and finding gaps. Returns team members and their booked/free time slots. Assumes a standard work day of 8:00-17:00.",
    {
      start_date: z
        .string()
        .describe("Start date in YYYY-MM-DD format"),
      end_date: z
        .string()
        .describe("End date in YYYY-MM-DD format"),
      work_day_start: z
        .string()
        .default("08:00")
        .describe("Work day start time in HH:MM format. Default '08:00'."),
      work_day_end: z
        .string()
        .default("17:00")
        .describe("Work day end time in HH:MM format. Default '17:00'."),
    },
    async ({ start_date, end_date, work_day_start, work_day_end }) => {
      try {
        // Fetch team members
        const usersData = await jobberRequest(LIST_USERS, { first: 50 });
        const users = ((usersData.users as Record<string, unknown>)?.nodes ??
          []) as Array<{
          id: string;
          name: { full: string };
          email?: { raw: string };
          role: string;
        }>;

        // Fetch schedule for the date range
        const scheduleData = await jobberRequest(GET_SCHEDULE, {
          startAt: start_date,
          endAt: end_date,
          first: 50,
        });
        const scheduledJobs = (
          (scheduleData.jobs as Record<string, unknown>)?.nodes ?? []
        ) as ScheduleJob[];

        // Build a map of team_member_id -> booked time slots
        const bookedSlots: Map<string, Array<{ start: string; end: string; job_title: string }>> =
          new Map();

        for (const job of scheduledJobs) {
          const visits = job.visits?.nodes ?? [];
          for (const visit of visits) {
            const assignedUsers = visit.assignedUsers?.nodes ?? [];
            for (const user of assignedUsers) {
              if (!bookedSlots.has(user.id)) {
                bookedSlots.set(user.id, []);
              }
              bookedSlots.get(user.id)!.push({
                start: visit.startAt,
                end: visit.endAt,
                job_title: (job as Record<string, unknown>).title as string ?? "Untitled",
              });
            }
          }
        }

        // Build availability per team member
        const availability = users
          .filter((u) => u.role !== "ACCOUNT_OWNER" || users.length <= 2) // Include owner for small teams
          .map((user) => {
            const booked = bookedSlots.get(user.id) ?? [];
            return {
              id: user.id,
              name: user.name.full,
              role: user.role,
              booked_slots: booked.sort(
                (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
              ),
              work_hours: { start: work_day_start, end: work_day_end },
              total_booked_hours: booked.reduce((sum, slot) => {
                const dur =
                  (new Date(slot.end).getTime() - new Date(slot.start).getTime()) /
                  3_600_000;
                return sum + dur;
              }, 0),
            };
          });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  date_range: { start: start_date, end: end_date },
                  work_hours: { start: work_day_start, end: work_day_end },
                  team_availability: availability,
                  note: "Free time = work_hours minus booked_slots. Derive open windows from the gaps.",
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return formatErrorForMCP(error);
      }
    }
  );
}
