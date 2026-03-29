/**
 * MCP tools for Jobber job operations.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  jobberRequest,
  LIST_JOBS,
  GET_JOB,
  CREATE_JOB,
  CREATE_JOB_NOTE,
} from "../graphql/queries.js";
import { extractUserErrors, formatErrorForMCP } from "../utils/errors.js";

export function registerJobTools(server: McpServer): void {
  // ── List Jobs ────────────────────────────────────────────────────
  server.tool(
    "jobber_list_jobs",
    "List jobs in Jobber with optional filters. Returns jobs with status, client, schedule, and total. Use this to find active work, check job history, or look up jobs for a specific client.",
    {
      status: z
        .array(
          z.enum([
            "ACTIVE",
            "IN_PROGRESS",
            "COMPLETED",
            "ARCHIVED",
            "TODAY",
            "UPCOMING",
            "OVERDUE",
            "UNSCHEDULED",
            "LATE",
            "ON_HOLD",
            "ACTION_REQUIRED",
          ])
        )
        .optional()
        .describe(
          "Filter by job status. Common values: ACTIVE, IN_PROGRESS, COMPLETED, ARCHIVED. Can pass multiple. Omit for all statuses."
        ),
      start_date: z
        .string()
        .optional()
        .describe(
          "Filter jobs starting on or after this date. ISO 8601 format (YYYY-MM-DD)."
        ),
      end_date: z
        .string()
        .optional()
        .describe(
          "Filter jobs starting on or before this date. ISO 8601 format (YYYY-MM-DD)."
        ),
      limit: z
        .number()
        .min(1)
        .max(50)
        .default(20)
        .describe("Maximum number of jobs to return. Default 20, max 50."),
      after: z
        .string()
        .optional()
        .describe("Pagination cursor for the next page."),
    },
    async ({ status, start_date, end_date, limit, after }) => {
      try {
        const filter: Record<string, unknown> = {};
        if (status && status.length > 0) {
          filter.status = status;
        }
        if (start_date || end_date) {
          filter.startAt = {
            between: {
              start: start_date ?? "2000-01-01",
              end: end_date ?? "2100-01-01",
            },
          };
        }

        const variables: Record<string, unknown> = {
          first: limit,
          filter: Object.keys(filter).length > 0 ? filter : undefined,
        };
        if (after) variables.after = after;

        const data = await jobberRequest(LIST_JOBS, variables);
        const jobs = data.jobs as {
          nodes: unknown[];
          totalCount: number;
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  total_count: jobs.totalCount,
                  jobs: jobs.nodes,
                  page_info: jobs.pageInfo,
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

  // ── Get Job ──────────────────────────────────────────────────────
  server.tool(
    "jobber_get_job",
    "Get full details for a specific job by ID. Returns comprehensive info including line items, scheduled visits, assigned team members, client contact info, and property address.",
    {
      job_id: z.string().describe("The Jobber job ID"),
    },
    async ({ job_id }) => {
      try {
        const data = await jobberRequest(GET_JOB, { id: job_id });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(data.job, null, 2) },
          ],
        };
      } catch (error) {
        return formatErrorForMCP(error);
      }
    }
  );

  // ── Create Job ───────────────────────────────────────────────────
  server.tool(
    "jobber_create_job",
    "Create a new job in Jobber. A job represents actual work to be done for a client. Provide a client ID and job details. Line items define the billable work.",
    {
      client_id: z.string().describe("The Jobber client ID this job is for"),
      title: z
        .string()
        .describe("Job title (e.g. 'Kitchen faucet replacement', 'Drain cleaning')"),
      description: z
        .string()
        .optional()
        .describe("Detailed job description or instructions for the technician"),
      line_items: z
        .array(
          z.object({
            name: z.string().describe("Line item name (e.g. 'Labour', 'Parts - Kitchen Faucet')"),
            description: z.string().optional().describe("Line item description"),
            quantity: z.number().default(1).describe("Quantity. Default 1."),
            unit_price: z
              .number()
              .describe("Unit price in dollars (e.g. 150.00)"),
          })
        )
        .optional()
        .describe(
          "Line items for the job. Each has a name, optional description, quantity, and unit price."
        ),
      property_id: z
        .string()
        .optional()
        .describe("Property ID for the service location. Get from client details."),
    },
    async ({ client_id, title, description, line_items, property_id }) => {
      try {
        const input: Record<string, unknown> = {
          clientId: client_id,
          title,
        };
        if (property_id) input.propertyId = property_id;

        if (line_items && line_items.length > 0) {
          input.lineItems = line_items.map((li) => ({
            name: li.name,
            description: li.description ?? "",
            qty: li.quantity,
            unitPrice: li.unit_price,
            saveToProductsAndServices: false,
          }));
        }

        const data = await jobberRequest(CREATE_JOB, { input });
        const result = data.jobCreate as Record<string, unknown>;
        const userErr = extractUserErrors(result);
        if (userErr) {
          return {
            content: [{ type: "text" as const, text: `Failed to create job: ${userErr}` }],
            isError: true,
          };
        }

        const job = result.job as Record<string, unknown>;

        // Add description as a note if provided
        if (description && job.id) {
          try {
            await jobberRequest(CREATE_JOB_NOTE, {
              jobId: job.id,
              message: description,
            });
          } catch {
            console.error("[jobber-mcp] Failed to add note to job");
          }
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(job, null, 2) }],
        };
      } catch (error) {
        return formatErrorForMCP(error);
      }
    }
  );

  // ── Update Job Status ────────────────────────────────────────────
  server.tool(
    "jobber_update_job_status",
    "Add a note to a job in Jobber. Use this to log status updates, technician notes, or diagnostic findings. Note: Jobber's GraphQL API doesn't support direct status transitions — use the Jobber web UI for that.",
    {
      job_id: z.string().describe("The Jobber job ID"),
      note: z
        .string()
        .describe(
          "Note to add to the job (e.g. 'Customer confirmed appointment', 'Parts ordered — ETA 2 days')"
        ),
    },
    async ({ job_id, note }) => {
      try {
        const data = await jobberRequest(CREATE_JOB_NOTE, {
          jobId: job_id,
          message: note,
        });
        const result = data.jobNoteCreate as Record<string, unknown>;
        const userErr = extractUserErrors(result);
        if (userErr) {
          return {
            content: [{ type: "text" as const, text: `Failed to add note: ${userErr}` }],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Note added to job ${job_id} successfully.`,
            },
          ],
        };
      } catch (error) {
        return formatErrorForMCP(error);
      }
    }
  );
}
