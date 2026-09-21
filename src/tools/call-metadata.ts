import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { gongRequest } from "../gong-client.js";

export function registerCallMetadataTools(server: McpServer): void {
  server.registerTool(
    "add_call_metadata",
    {
      description:
        "Register a new call in Gong with metadata. Does not upload audio — use this for calls recorded externally.",
      inputSchema: {
        clientUniqueId: z.string().describe("Your unique ID for this call (for deduplication)"),
        actualStart: z.string().describe("Actual start time (ISO-8601)"),
        direction: z.enum(["Inbound", "Outbound", "Conference", "Unknown"]).describe("Call direction"),
        parties: z.array(
          z.object({
            name: z.string().optional().describe("Participant name"),
            emailAddress: z.string().optional().describe("Participant email"),
            phoneNumber: z.string().optional().describe("Participant phone"),
            userId: z.string().optional().describe("Gong user ID. Required for the participant matching primaryUser."),
          })
        ).describe("Call participants. One party must have a userId matching primaryUser."),
        primaryUser: z.string().describe("Gong user ID of the team member who hosted the call. Use list_users to find IDs."),
        title: z.string().optional().describe("Call title"),
        duration: z.number().optional().describe("Call duration in seconds"),
        workspaceId: z.string().optional().describe("Workspace ID"),
      },
      outputSchema: {
        status: z.string(),
        callId: z.string(),
      },
      annotations: { openWorldHint: true },
    },
    async ({ clientUniqueId, actualStart, direction, parties, primaryUser, title, duration, workspaceId }) => {
      const body: Record<string, unknown> = { clientUniqueId, actualStart, direction, parties, primaryUser };
      if (title) body.title = title;
      if (duration) body.duration = duration;
      if (workspaceId) body.workspaceId = workspaceId;
      const result = await gongRequest({ method: "POST", path: "/v2/calls", body }) as Record<string, unknown>;
      const output = { status: "success", callId: result.callId as string };
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
    }
  );
}
