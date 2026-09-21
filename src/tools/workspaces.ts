import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gongRequest } from "../gong-client.js";

export function registerWorkspaceTools(server: McpServer): void {
  server.registerTool(
    "list_workspaces",
    {
      description: "List all company workspaces in Gong.",
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      const result = await gongRequest({ method: "GET", path: "/v2/workspaces", notFoundAsEmpty: true });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}
