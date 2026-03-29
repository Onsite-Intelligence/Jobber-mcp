/**
 * MCP tools for Jobber quote operations.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  jobberRequest,
  CREATE_QUOTE,
  LIST_QUOTES,
} from "../graphql/queries.js";
import { extractUserErrors, formatErrorForMCP } from "../utils/errors.js";

export function registerQuoteTools(server: McpServer): void {
  // ── Create Quote ─────────────────────────────────────────────────
  server.tool(
    "jobber_create_quote",
    "Create a new quote (estimate) for a Jobber client. The quote is created as a draft — it won't be sent to the client automatically. Include line items with pricing to build the quote total.",
    {
      client_id: z.string().describe("The Jobber client ID to create the quote for"),
      title: z
        .string()
        .describe("Quote title (e.g. 'Kitchen faucet replacement estimate')"),
      message: z
        .string()
        .optional()
        .describe(
          "Message to the client included with the quote. Supports plain text."
        ),
      line_items: z
        .array(
          z.object({
            name: z
              .string()
              .describe("Line item name (e.g. 'Labour - Faucet Installation')"),
            description: z.string().optional().describe("Line item description"),
            quantity: z.number().default(1).describe("Quantity. Default 1."),
            unit_price: z
              .number()
              .describe("Unit price in dollars (e.g. 250.00)"),
          })
        )
        .min(1)
        .describe("At least one line item is required for a quote."),
      property_id: z
        .string()
        .optional()
        .describe("Property ID for the service location"),
    },
    async ({ client_id, title, message, line_items, property_id }) => {
      try {
        const attributes: Record<string, unknown> = {
          clientId: client_id,
          title,
          lineItems: line_items.map((li) => ({
            name: li.name,
            description: li.description ?? "",
            qty: li.quantity,
            unitPrice: li.unit_price,
            saveToProductsAndServices: false,
          })),
        };
        if (message) attributes.message = message;
        if (property_id) attributes.propertyId = property_id;

        const data = await jobberRequest(CREATE_QUOTE, { attributes });
        const result = data.quoteCreate as Record<string, unknown>;
        const userErr = extractUserErrors(result);
        if (userErr) {
          return {
            content: [
              { type: "text" as const, text: `Failed to create quote: ${userErr}` },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result.quote, null, 2),
            },
          ],
        };
      } catch (error) {
        return formatErrorForMCP(error);
      }
    }
  );

  // ── List Quotes ──────────────────────────────────────────────────
  server.tool(
    "jobber_list_quotes",
    "List quotes in Jobber. Returns quotes with their status, total, client, and Jobber web URL. Supports pagination.",
    {
      limit: z
        .number()
        .min(1)
        .max(50)
        .default(20)
        .describe("Maximum number of quotes to return. Default 20, max 50."),
      after: z
        .string()
        .optional()
        .describe("Pagination cursor for the next page."),
    },
    async ({ limit, after }) => {
      try {
        const variables: Record<string, unknown> = { first: limit };
        if (after) variables.after = after;

        const data = await jobberRequest(LIST_QUOTES, variables);
        const quotes = data.quotes as {
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
                  total_count: quotes.totalCount,
                  quotes: quotes.nodes,
                  page_info: quotes.pageInfo,
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
