import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { gongRequest } from "../gong-client.js";

export function registerCallAccessTools(server: McpServer): void {
  server.registerTool(
    "get_users_access_to_calls",
    {
      description: "Check which users have individual access to specific calls.",
      inputSchema: {
        callIds: z.array(z.string()).min(1).describe("Call IDs to check access for"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ callIds }) => {
      const result = await gongRequest({
        method: "POST",
        path: "/v2/calls/users-access",
        body: { filter: { callIds } },
        notFoundAsEmpty: true,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "add_users_access_to_calls",
    {
      description: "Give individual users access to a specific call.",
      inputSchema: {
        callId: z.string().describe("Call ID to grant access to"),
        userIds: z.array(z.string()).min(1).describe("User IDs to grant access"),
      },
      outputSchema: {
        status: z.string(),
        callId: z.string(),
        userIds: z.array(z.string()),
      },
      annotations: { openWorldHint: true },
    },
    async ({ callId, userIds }) => {
      await gongRequest({
        method: "PUT",
        path: "/v2/calls/users-access",
        body: { callAccessList: [{ callId, userIds }] },
      });
      const output = { status: "success", callId, userIds };
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
    }
  );

  server.registerTool(
    "delete_users_access_to_calls",
    {
      description: "Remove individual user access from a specific call.",
      inputSchema: {
        callId: z.string().describe("Call ID to revoke access from"),
        userIds: z.array(z.string()).min(1).describe("User IDs to revoke access"),
      },
      outputSchema: {
        status: z.string(),
        callId: z.string(),
        userIds: z.array(z.string()),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async ({ callId, userIds }) => {
      await gongRequest({
        method: "DELETE",
        path: "/v2/calls/users-access",
        body: { callAccessList: [{ callId, userIds }] },
      });
      const output = { status: "success", callId, userIds };
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
    }
  );
}
