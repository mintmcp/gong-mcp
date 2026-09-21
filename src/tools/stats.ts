import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { gongFetchPage } from "../gong-client.js";

export function registerStatsTools(server: McpServer): void {
  server.registerTool(
    "get_interaction_stats",
    {
      description:
        "Get per-call interaction stats (talk ratio, longest monologue, patience, etc.) for users in a date range. Stats are available from yesterday and earlier — today's calls are not yet included.",
      inputSchema: {
        fromDate: z.string().describe("Start date YYYY-MM-DD"),
        toDate: z.string().describe("End date YYYY-MM-DD (exclusive). Cannot be in the future. Today's stats are not available until tomorrow."),
        userIds: z.array(z.string()).optional().describe("Filter to specific user IDs"),
        nextPageToken: z.string().optional().describe("Token from a previous response to fetch the next page"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ fromDate, toDate, userIds, nextPageToken }) => {
      const filter: Record<string, unknown> = { fromDate, toDate };
      if (userIds) filter.userIds = userIds;
      const result = await gongFetchPage({
        method: "POST",
        path: "/v2/stats/interaction",
        body: { filter },
        cursor: nextPageToken,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "get_aggregate_activity",
    {
      description:
        "Get aggregated activity stats (calls made, emails sent, etc.) for users over a date range. Stats are available from yesterday and earlier — today's activity is not yet included.",
      inputSchema: {
        fromDate: z.string().describe("Start date YYYY-MM-DD"),
        toDate: z.string().describe("End date YYYY-MM-DD (exclusive). Cannot be in the future. Today's stats are not available until tomorrow."),
        userIds: z.array(z.string()).optional().describe("Filter to specific user IDs"),
        nextPageToken: z.string().optional().describe("Token from a previous response to fetch the next page"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ fromDate, toDate, userIds, nextPageToken }) => {
      const filter: Record<string, unknown> = { fromDate, toDate };
      if (userIds) filter.userIds = userIds;
      const result = await gongFetchPage({
        method: "POST",
        path: "/v2/stats/activity/aggregate",
        body: { filter },
        cursor: nextPageToken,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}
