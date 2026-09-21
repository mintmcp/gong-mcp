import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { gongFetchPage } from "../gong-client.js";

export function registerUserTools(server: McpServer): void {
  server.registerTool(
    "list_users",
    {
      description:
        "List all users in the Gong account. Returns user IDs, names, emails, and roles. Use this to find user IDs needed by stats and call-filter tools.",
      inputSchema: {
        includeAvatars: z
          .boolean()
          .default(false)
          .describe("Include user avatar URLs in results"),
        nextPageToken: z.string().optional().describe("Token from a previous response to fetch the next page"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ includeAvatars, nextPageToken }) => {
      const query: Record<string, string> = {};
      if (includeAvatars) query.includeAvatars = "true";
      const result = await gongFetchPage({ method: "GET", path: "/v2/users", query, cursor: nextPageToken });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}
