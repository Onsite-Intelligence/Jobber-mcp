#!/usr/bin/env node

/**
 * Jobber MCP Server — provides Claude (or any MCP client) with tools
 * to interact with a Jobber account via the GraphQL API.
 *
 * Supports two transport modes:
 *   - stdio (default): for Claude Code / local dev
 *   - streamable-http: for remote/hosted deployments
 *
 * Set TRANSPORT=http to use HTTP mode, or leave unset for stdio.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadTokensFromEnv } from "./auth/oauth.js";

// Load .env from project root (works for both src/ and dist/)
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env");
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val; // don't override existing env
  }
} catch {
  // .env is optional — env vars can be passed directly
}
import { registerClientTools } from "./tools/clients.js";
import { registerRequestTools } from "./tools/requests.js";
import { registerJobTools } from "./tools/jobs.js";
import { registerSchedulingTools } from "./tools/scheduling.js";
import { registerQuoteTools } from "./tools/quotes.js";
import { registerInvoiceTools } from "./tools/invoices.js";
import { startStdioTransport, startHttpTransport } from "./transport.js";

async function main(): Promise<void> {
  // Validate auth tokens are available
  try {
    loadTokensFromEnv();
  } catch (error) {
    console.error(`[jobber-mcp] ${(error as Error).message}`);
    process.exit(1);
  }

  // Create MCP server
  const server = new McpServer({
    name: "jobber",
    version: "1.0.0",
  });

  // Register all tool categories
  registerClientTools(server);
  registerRequestTools(server);
  registerJobTools(server);
  registerSchedulingTools(server);
  registerQuoteTools(server);
  registerInvoiceTools(server);

  // Start the appropriate transport
  const transport = process.env.TRANSPORT ?? "stdio";
  if (transport === "http") {
    await startHttpTransport(server);
  } else {
    await startStdioTransport(server);
  }
}

main().catch((error) => {
  console.error("[jobber-mcp] Fatal error:", error);
  process.exit(1);
});
