import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { requestContext, resolveAuthorization, parseBearerToken, resolveBaseUrl } from "./gong-client.js";
import { registerCallTools } from "./tools/calls.js";
import { registerUserTools } from "./tools/users.js";
import { registerStatsTools } from "./tools/stats.js";
import { registerSettingsTools } from "./tools/settings.js";
import { registerCallOutcomeTools } from "./tools/call-outcomes.js";
import { registerWorkspaceTools } from "./tools/workspaces.js";
import { registerCallAccessTools } from "./tools/call-access.js";
import { registerCallMetadataTools } from "./tools/call-metadata.js";
import { registerMeetingTools } from "./tools/meetings.js";

// Single source of truth for the version reported to MCP clients.
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

/**
 * Build a fully registered McpServer. Called once per request: the SDK binds
 * one transport per McpServer, so a shared instance fails with "Already
 * connected to a transport" as soon as two requests overlap.
 */
export function createServer(): McpServer {
  const server = new McpServer(
    { name: "gong", version },
    {
      instructions:
        "Gong conversation intelligence API. Find calls with list_calls (ISO-8601 date range, paginate with nextPageToken), then get_call for one call's details or get_call_transcripts for speaker-segmented transcripts. list_users returns the user IDs needed by get_interaction_stats, get_aggregate_activity and add_call_metadata; list_workspaces returns workspace IDs for filtering. Stats cover yesterday and earlier only. Write tools (add_call_metadata, add_meeting, update_meeting, delete_meeting, add_users_access_to_calls, delete_users_access_to_calls) change data in Gong and return a tool error if the target does not exist.",
    }
  );
  registerCallTools(server);
  registerUserTools(server);
  registerStatsTools(server);
  registerSettingsTools(server);
  registerCallOutcomeTools(server);
  registerWorkspaceTools(server);
  registerCallAccessTools(server);
  registerCallMetadataTools(server);
  registerMeetingTools(server);
  return server;
}

// ─── HTTP Transport ───────────────────────────────────────────────────────────

export const app = express();
app.disable("x-powered-by");
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/mcp", async (req, res) => {
  // Resolve auth for this request. A per-user OAuth token (header) takes
  // precedence; otherwise fall back to a shared service account (GONG_ACCESS_KEY
  // + GONG_ACCESS_KEY_SECRET -> Basic) or a shared env bearer token. The MintMCP
  // connector config decides which of these is present, so no mode flag is needed.
  // Per-user token: a custom header, or a (case-insensitive) Bearer Authorization
  // header. A per-user token must win over the shared service account, so dropping
  // a valid "bearer <t>" here would silently widen access — hence parseBearerToken.
  const headerToken =
    (req.headers["x-gong-access-token"] as string) ||
    parseBearerToken(req.headers["authorization"] as string | undefined) ||
    "";
  const authorization = resolveAuthorization({
    headerToken,
    accessKey: process.env.GONG_ACCESS_KEY,
    accessKeySecret: process.env.GONG_ACCESS_KEY_SECRET,
    envToken: process.env.GONG_ACCESS_TOKEN,
  });
  const baseUrl = resolveBaseUrl(req.headers["x-gong-base-url"] as string | undefined);

  // Stateless mode: the SDK requires a fresh transport per request, and a
  // McpServer can only be connected to one transport at a time, so both are
  // created here and torn down when the response closes.
  const mcp = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  // Wrap the entire MCP handling in the async context so all tool calls
  // within this request can access the user's credentials.
  await requestContext.run({ authorization, baseUrl }, async () => {
    try {
      res.on("close", () => mcp.close().catch((e) => console.error(`MCP close error: ${e}`)));
      await mcp.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error(`MCP request error: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });
});

// Stateless server: no standalone SSE stream (GET) and no session to delete
// (DELETE). Answer 405 with a JSON-RPC error body, as the SDK's stateless
// example does, instead of Express's HTML 404.
function methodNotAllowed(_req: express.Request, res: express.Response) {
  res
    .status(405)
    .set("Allow", "POST")
    .json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
}
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);
