import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { gongRequest } from "../gong-client.js";

export function registerMeetingTools(server: McpServer): void {
  server.registerTool(
    "add_meeting",
    {
      description: "Create a new Gong meeting.",
      inputSchema: {
        title: z.string().optional().describe("Meeting title"),
        startTime: z.string().describe("Start time (ISO-8601)"),
        endTime: z.string().describe("End time (ISO-8601)"),
        organizerEmail: z.string().describe("Email of the meeting organizer"),
        invitees: z.array(
          z.object({
            email: z.string().describe("Invitee email"),
          })
        ).describe("Meeting invitees"),
        externalId: z.string().optional().describe("External meeting ID (e.g. from calendar system)"),
      },
      outputSchema: {
        status: z.string(),
        meetingId: z.string(),
        meetingUrl: z.string().optional(),
      },
      annotations: { openWorldHint: true },
    },
    async ({ title, startTime, endTime, organizerEmail, invitees, externalId }) => {
      const body: Record<string, unknown> = { startTime, endTime, organizerEmail, invitees };
      if (title) body.title = title;
      if (externalId) body.externalId = externalId;
      const result = await gongRequest({ method: "POST", path: "/v2/meetings", body }) as Record<string, unknown>;
      const output = { status: "success", meetingId: result.meetingId as string, meetingUrl: result.meetingUrl as string | undefined };
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
    }
  );

  server.registerTool(
    "update_meeting",
    {
      description: "Update an existing Gong meeting.",
      inputSchema: {
        meetingId: z.string().describe("Gong meeting ID"),
        title: z.string().optional().describe("Meeting title"),
        startTime: z.string().describe("Start time (ISO-8601)"),
        endTime: z.string().describe("End time (ISO-8601)"),
        organizerEmail: z.string().describe("Email of the meeting organizer"),
        invitees: z.array(
          z.object({
            email: z.string().describe("Invitee email"),
          })
        ).describe("Meeting invitees"),
        externalId: z.string().optional().describe("External meeting ID"),
      },
      outputSchema: {
        status: z.string(),
        meetingId: z.string(),
      },
      annotations: { openWorldHint: true },
    },
    async ({ meetingId, title, startTime, endTime, organizerEmail, invitees, externalId }) => {
      const body: Record<string, unknown> = { startTime, endTime, organizerEmail, invitees };
      if (title) body.title = title;
      if (externalId) body.externalId = externalId;
      await gongRequest({
        method: "PUT",
        path: `/v2/meetings/${encodeURIComponent(meetingId)}`,
        body,
      });
      const output = { status: "success", meetingId };
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
    }
  );

  server.registerTool(
    "delete_meeting",
    {
      description: "Delete a Gong meeting.",
      inputSchema: {
        meetingId: z.string().describe("Gong meeting ID"),
        organizerEmail: z.string().optional().describe("Email of the meeting organizer"),
      },
      outputSchema: {
        status: z.string(),
        meetingId: z.string(),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async ({ meetingId, organizerEmail }) => {
      const body: Record<string, unknown> = {};
      if (organizerEmail) body.organizerEmail = organizerEmail;
      await gongRequest({
        method: "DELETE",
        path: `/v2/meetings/${encodeURIComponent(meetingId)}`,
        body,
      });
      const output = { status: "success", meetingId };
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
    }
  );
}
