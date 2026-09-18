import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gongRequest } from "../gong-client.js";

export function registerCallOutcomeTools(server: McpServer): void {
  server.registerTool(
    "list_call_outcomes",
    {
      description: "List all call outcome labels configured in Gong.",
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      const result = await gongRequest({ method: "GET", path: "/v2/call-outcomes", notFoundAsEmpty: true });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}
