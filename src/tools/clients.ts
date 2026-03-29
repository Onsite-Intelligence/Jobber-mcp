/**
 * MCP tools for Jobber client/customer operations.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  jobberRequest,
  SEARCH_CLIENTS,
  GET_CLIENT,
  CREATE_CLIENT,
  UPDATE_CLIENT,
} from "../graphql/queries.js";
import { extractUserErrors } from "../utils/errors.js";
import { formatErrorForMCP } from "../utils/errors.js";

export function registerClientTools(server: McpServer): void {
  // ── Search Clients ───────────────────────────────────────────────
  server.tool(
    "jobber_search_clients",
    "Search for clients (customers) in Jobber by name, email, or phone number. Returns matching clients with their contact info, address, and tags. Use this to find existing clients before creating new ones.",
    {
      search_term: z
        .string()
        .describe(
          "The search query — can be a name, email address, or phone number. Jobber searches across all contact fields."
        ),
      limit: z
        .number()
        .min(1)
        .max(50)
        .default(10)
        .describe(
          "Maximum number of results to return. Default 10, max 50."
        ),
    },
    async ({ search_term, limit }) => {
      try {
        const data = await jobberRequest(SEARCH_CLIENTS, {
          searchTerm: search_term,
          first: limit,
        });
        const clients = data.clients as {
          nodes: unknown[];
          totalCount: number;
        };
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  total_count: clients.totalCount,
                  clients: clients.nodes,
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

  // ── Get Client ───────────────────────────────────────────────────
  server.tool(
    "jobber_get_client",
    "Get full details for a specific Jobber client by their ID. Returns contact info, properties (service addresses), and recent job history. Use this after searching to get complete client information.",
    {
      client_id: z
        .string()
        .describe(
          "The Jobber client ID (encoded ID format, e.g. 'Z2lkOi8vSm9iYmVyL0NsaWVudC8xMjM='). Get this from search results."
        ),
    },
    async ({ client_id }) => {
      try {
        const data = await jobberRequest(GET_CLIENT, { id: client_id });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(data.client, null, 2) },
          ],
        };
      } catch (error) {
        return formatErrorForMCP(error);
      }
    }
  );

  // ── Create Client ────────────────────────────────────────────────
  server.tool(
    "jobber_create_client",
    "Create a new client (customer) in Jobber. Always search for existing clients first to avoid duplicates. Returns the new client's ID and Jobber web URL.",
    {
      first_name: z.string().describe("Client's first name"),
      last_name: z.string().describe("Client's last name"),
      email: z
        .string()
        .optional()
        .describe("Client's email address. Recommended for sending quotes/invoices."),
      phone: z
        .string()
        .optional()
        .describe(
          "Client's phone number. Include country code if applicable (e.g. '+14165551234')."
        ),
      company_name: z
        .string()
        .optional()
        .describe(
          "Company name if this is a commercial/business client. Sets isCompany=true."
        ),
      street1: z.string().optional().describe("Street address line 1"),
      street2: z.string().optional().describe("Street address line 2 (unit, suite, etc.)"),
      city: z.string().optional().describe("City"),
      province: z.string().optional().describe("Province/state (2-letter code, e.g. 'ON', 'CA')"),
      postal_code: z.string().optional().describe("Postal/ZIP code"),
    },
    async ({
      first_name,
      last_name,
      email,
      phone,
      company_name,
      street1,
      street2,
      city,
      province,
      postal_code,
    }) => {
      try {
        const input: Record<string, unknown> = {
          firstName: first_name,
          lastName: last_name,
        };

        if (company_name) {
          input.companyName = company_name;
          input.isCompany = true;
        }
        if (phone) {
          input.phones = [
            { number: phone, description: "MAIN", primary: true },
          ];
        }
        if (email) {
          input.emails = [
            { address: email, description: "MAIN", primary: true },
          ];
        }
        if (street1) {
          input.billingAddress = {
            street1,
            street2: street2 ?? "",
            city: city ?? "",
            province: province ?? "",
            postalCode: postal_code ?? "",
          };
        }

        const data = await jobberRequest(CREATE_CLIENT, { input });
        const result = data.clientCreate as Record<string, unknown>;
        const userErr = extractUserErrors(result);
        if (userErr) {
          return {
            content: [{ type: "text" as const, text: `Failed to create client: ${userErr}` }],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result.client, null, 2),
            },
          ],
        };
      } catch (error) {
        return formatErrorForMCP(error);
      }
    }
  );

  // ── Update Client ────────────────────────────────────────────────
  server.tool(
    "jobber_update_client",
    "Update an existing Jobber client's information. Only provide the fields you want to change — omitted fields remain unchanged.",
    {
      client_id: z.string().describe("The Jobber client ID to update"),
      first_name: z.string().optional().describe("Updated first name"),
      last_name: z.string().optional().describe("Updated last name"),
      email: z.string().optional().describe("Updated email address"),
      phone: z.string().optional().describe("Updated phone number"),
      company_name: z.string().optional().describe("Updated company name"),
    },
    async ({ client_id, first_name, last_name, email, phone, company_name }) => {
      try {
        const input: Record<string, unknown> = {};
        if (first_name) input.firstName = first_name;
        if (last_name) input.lastName = last_name;
        if (company_name) input.companyName = company_name;
        if (phone) {
          input.phones = [
            { number: phone, description: "MAIN", primary: true },
          ];
        }
        if (email) {
          input.emails = [
            { address: email, description: "MAIN", primary: true },
          ];
        }

        const data = await jobberRequest(UPDATE_CLIENT, {
          clientId: client_id,
          input,
        });
        const result = data.clientUpdate as Record<string, unknown>;
        const userErr = extractUserErrors(result);
        if (userErr) {
          return {
            content: [{ type: "text" as const, text: `Failed to update client: ${userErr}` }],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result.client, null, 2),
            },
          ],
        };
      } catch (error) {
        return formatErrorForMCP(error);
      }
    }
  );
}
