import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { gongRequest, gongFetchPage } from "../gong-client.js";

export function registerCallTools(server: McpServer): void {
  server.registerTool(
    "list_calls",
    {
      description:
        "List calls by date range. Returns call metadata (IDs, titles, dates, participants). Use get_call for full details or get_call_transcripts for transcripts.",
      inputSchema: {
        fromDateTime: z
          .string()
          .describe("Start date/time in ISO-8601 format (e.g. '2024-01-01T00:00:00Z')"),
        toDateTime: z
          .string()
          .describe("End date/time in ISO-8601 format (e.g. '2024-01-31T23:59:59Z')"),
        workspaceId: z.string().optional().describe("Filter by workspace ID"),
        nextPageToken: z.string().optional().describe("Token from a previous response to fetch the next page"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ fromDateTime, toDateTime, workspaceId, nextPageToken }) => {
      const query: Record<string, string> = { fromDateTime, toDateTime };
      if (workspaceId) query.workspaceId = workspaceId;
      const result = await gongFetchPage({ method: "GET", path: "/v2/calls", query, cursor: nextPageToken });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "get_call",
    {
      description: "Get full details for a single call by its ID.",
      inputSchema: {
        callId: z.string().describe("The Gong call ID"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ callId }) => {
      const result = await gongRequest({ method: "GET", path: `/v2/calls/${encodeURIComponent(callId)}` });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "get_call_transcripts",
    {
      description:
        "Get transcripts for one or more calls. Returns speaker-segmented transcript text. Requires call IDs — use list_calls to find them first.",
      inputSchema: {
        callIds: z.array(z.string()).min(1).describe("Call IDs to get transcripts for"),
        fromDateTime: z.string().optional().describe("Filter calls starting from this ISO-8601 datetime"),
        toDateTime: z.string().optional().describe("Filter calls up to this ISO-8601 datetime"),
        nextPageToken: z.string().optional().describe("Token from a previous response to fetch the next page"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ callIds, fromDateTime, toDateTime, nextPageToken }) => {
      const filter: Record<string, unknown> = { callIds };
      if (fromDateTime) filter.fromDateTime = fromDateTime;
      if (toDateTime) filter.toDateTime = toDateTime;

      const result = await gongFetchPage({
        method: "POST",
        path: "/v2/calls/transcript",
        body: { filter },
        cursor: nextPageToken,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}
