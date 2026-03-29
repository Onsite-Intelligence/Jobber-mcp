/**
 * MCP tools for Jobber invoice operations.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  jobberRequest,
  LIST_INVOICES,
  GET_INVOICE,
} from "../graphql/queries.js";
import { formatErrorForMCP } from "../utils/errors.js";

export function registerInvoiceTools(server: McpServer): void {
  // ── List Invoices ────────────────────────────────────────────────
  server.tool(
    "jobber_list_invoices",
    "List invoices in Jobber. Returns invoices with status (draft, sent, paid, overdue, etc.), amounts, dates, and client info. Supports pagination.",
    {
      limit: z
        .number()
        .min(1)
        .max(50)
        .default(20)
        .describe("Maximum number of invoices to return. Default 20, max 50."),
      after: z
        .string()
        .optional()
        .describe("Pagination cursor for the next page."),
    },
    async ({ limit, after }) => {
      try {
        const variables: Record<string, unknown> = { first: limit };
        if (after) variables.after = after;

        const data = await jobberRequest(LIST_INVOICES, variables);
        const invoices = data.invoices as {
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
                  total_count: invoices.totalCount,
                  invoices: invoices.nodes,
                  page_info: invoices.pageInfo,
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

  // ── Get Invoice ──────────────────────────────────────────────────
  server.tool(
    "jobber_get_invoice",
    "Get full details for a specific invoice by ID. Returns line items, amounts, payment status, due date, and client contact info.",
    {
      invoice_id: z.string().describe("The Jobber invoice ID"),
    },
    async ({ invoice_id }) => {
      try {
        const data = await jobberRequest(GET_INVOICE, { id: invoice_id });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(data.invoice, null, 2),
            },
          ],
        };
      } catch (error) {
        return formatErrorForMCP(error);
      }
    }
  );
}
