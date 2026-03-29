/**
 * MCP tools for Jobber service request operations.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  jobberRequest,
  CREATE_REQUEST,
  LIST_REQUESTS,
  GET_REQUEST,
  CREATE_REQUEST_NOTE,
} from "../graphql/queries.js";
import { extractUserErrors, formatErrorForMCP } from "../utils/errors.js";

export function registerRequestTools(server: McpServer): void {
  // ── Create Request ───────────────────────────────────────────────
  server.tool(
    "jobber_create_request",
    "Create a new service request in Jobber. A request represents an incoming inquiry from a customer that hasn't been converted to a job yet. Optionally attach a note with details about the issue.",
    {
      client_id: z
        .string()
        .describe(
          "The Jobber client ID to create the request for. Search for or create the client first."
        ),
      title: z
        .string()
        .max(255)
        .describe(
          "Short title for the request (max 255 chars). E.g. 'Leaking kitchen faucet', 'Annual furnace maintenance'."
        ),
      details: z
        .string()
        .optional()
        .describe(
          "Detailed description of the service request. This gets added as a note on the request since Jobber doesn't have a details field on requests directly."
        ),
      property_id: z
        .string()
        .optional()
        .describe(
          "The property ID if the request is for a specific service address. Get this from the client's properties."
        ),
    },
    async ({ client_id, title, details, property_id }) => {
      try {
        const input: Record<string, unknown> = {
          clientId: client_id,
          title,
        };
        if (property_id) input.propertyId = property_id;

        const data = await jobberRequest(CREATE_REQUEST, { input });
        const result = data.requestCreate as Record<string, unknown>;
        const userErr = extractUserErrors(result);
        if (userErr) {
          return {
            content: [{ type: "text" as const, text: `Failed to create request: ${userErr}` }],
            isError: true,
          };
        }

        const request = result.request as Record<string, unknown>;

        // Add details as a note if provided
        if (details && request.id) {
          try {
            await jobberRequest(CREATE_REQUEST_NOTE, {
              requestId: request.id,
              message: details,
            });
          } catch {
            // Non-fatal — request was created, note just failed
            console.error("[jobber-mcp] Failed to add note to request");
          }
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(request, null, 2) }],
        };
      } catch (error) {
        return formatErrorForMCP(error);
      }
    }
  );

  // ── List Requests ────────────────────────────────────────────────
  server.tool(
    "jobber_list_requests",
    "List service requests in Jobber. Returns requests with their status, client, and property info. Supports pagination for large result sets.",
    {
      limit: z
        .number()
        .min(1)
        .max(50)
        .default(20)
        .describe("Maximum number of requests to return. Default 20, max 50."),
      after: z
        .string()
        .optional()
        .describe(
          "Pagination cursor — pass the endCursor from a previous response to get the next page."
        ),
    },
    async ({ limit, after }) => {
      try {
        const variables: Record<string, unknown> = { first: limit };
        if (after) variables.after = after;

        const data = await jobberRequest(LIST_REQUESTS, variables);
        const requests = data.requests as {
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
                  total_count: requests.totalCount,
                  requests: requests.nodes,
                  page_info: requests.pageInfo,
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

  // ── Get Request ──────────────────────────────────────────────────
  server.tool(
    "jobber_get_request",
    "Get full details for a specific service request by ID. Returns the request with client contact info and property address.",
    {
      request_id: z.string().describe("The Jobber request ID"),
    },
    async ({ request_id }) => {
      try {
        const data = await jobberRequest(GET_REQUEST, { id: request_id });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(data.request, null, 2) },
          ],
        };
      } catch (error) {
        return formatErrorForMCP(error);
      }
    }
  );
}
