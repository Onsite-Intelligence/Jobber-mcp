/**
 * Transport configuration for stdio and streamable-http modes.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { randomUUID } from "crypto";

export async function startStdioTransport(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[jobber-mcp] Server running on stdio transport");
}

export async function startHttpTransport(server: McpServer): Promise<void> {
  const app = express();
  app.use(express.json());

  // Store transports by session ID
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && transports.has(sessionId)) {
      // Existing session
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res, req.body);
    } else {
      // New session
      const newTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });

      newTransport.onclose = () => {
        const sid = (newTransport as unknown as { sessionId?: string }).sessionId;
        if (sid) transports.delete(sid);
      };

      await server.connect(newTransport);
      await newTransport.handleRequest(req, res, req.body);

      // Store the transport using its session ID
      const sid = res.getHeader("mcp-session-id") as string | undefined;
      if (sid) {
        transports.set(sid, newTransport);
      }
    }
  });

  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res);
    } else {
      res.status(400).json({ error: "No session. Send a POST to /mcp first." });
    }
  });

  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res);
      transports.delete(sessionId);
    } else {
      res.status(400).json({ error: "No session found." });
    }
  });

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", transport: "streamable-http" });
  });

  const port = parseInt(process.env.HTTP_PORT ?? "3000", 10);
  const host = process.env.HTTP_HOST ?? "localhost";

  app.listen(port, host, () => {
    console.error(
      `[jobber-mcp] Server running on streamable-http at http://${host}:${port}/mcp`
    );
  });
}
