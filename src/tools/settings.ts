import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { gongRequest } from "../gong-client.js";

export function registerSettingsTools(server: McpServer): void {
  server.registerTool(
    "list_trackers",
    {
      description: "List all trackers (keyword/phrase tracking) configured in Gong.",
      inputSchema: {
        workspaceId: z.string().optional().describe("Filter by workspace ID"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ workspaceId }) => {
      const query: Record<string, string> = {};
      if (workspaceId) query.workspaceId = workspaceId;
      const result = await gongRequest({ method: "GET", path: "/v2/settings/trackers", query, notFoundAsEmpty: true });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}
