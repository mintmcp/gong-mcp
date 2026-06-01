import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";
import { gongRequest, gongFetchPage, requestContext, resolveAuthorization } from "./gong-client.js";

const server = new McpServer(
  { name: "gong", version: "1.0.0" },
  {
    instructions:
      "Gong conversation intelligence API. Use list_calls or list_calls_extensive to find calls, then get_call or get_call_transcripts for details. Use list_users to find user IDs needed by other tools. For actions not covered by dedicated tools, use search_actions to discover available API operations, then execute_action to run them.",
  }
);

// ─── Calls ────────────────────────────────────────────────────────────────────

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

// ─── Users ────────────────────────────────────────────────────────────────────

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


// ─── Stats ────────────────────────────────────────────────────────────────────

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

// ─── Settings ─────────────────────────────────────────────────────────────────


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
    const result = await gongRequest({ method: "GET", path: "/v2/settings/trackers", query });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ─── Call Outcomes ────────────────────────────────────────────────────────────

server.registerTool(
  "list_call_outcomes",
  {
    description: "List all call outcome labels configured in Gong.",
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => {
    const result = await gongRequest({ method: "GET", path: "/v2/call-outcomes" });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);


// ─── Workspaces ───────────────────────────────────────────────────────────────

server.registerTool(
  "list_workspaces",
  {
    description: "List all company workspaces in Gong.",
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => {
    const result = await gongRequest({ method: "GET", path: "/v2/workspaces" });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);


// ─── Call Access ──────────────────────────────────────────────────────────────

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

// ─── Call Metadata ────────────────────────────────────────────────────────────

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

// ─── Meetings ─────────────────────────────────────────────────────────────────

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


// ─── HTTP Transport ───────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  // Resolve auth for this request. A per-user OAuth token (header) takes
  // precedence; otherwise fall back to a shared service account (GONG_ACCESS_KEY
  // + GONG_ACCESS_KEY_SECRET -> Basic) or a shared env bearer token. The MintMCP
  // connector config decides which of these is present, so no mode flag is needed.
  const authHeader = req.headers["authorization"] as string | undefined;
  const headerToken =
    (req.headers["x-gong-access-token"] as string) ||
    (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "") ||
    "";
  const authorization =
    resolveAuthorization({
      headerToken,
      accessKey: process.env.GONG_ACCESS_KEY,
      accessKeySecret: process.env.GONG_ACCESS_KEY_SECRET,
      envToken: process.env.GONG_ACCESS_TOKEN,
    }) || "";
  const baseUrl = (req.headers["x-gong-base-url"] as string) || process.env.GONG_BASE_URL || "";

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  // Wrap the entire MCP handling in the async context so all tool calls
  // within this request can access the user's credentials.
  requestContext.run({ authorization, baseUrl: baseUrl || undefined }, async () => {
    try {
      res.on("close", () => transport.close());
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
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

const PORT = parseInt(process.env.PORT || "8000", 10);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Gong MCP server listening on 0.0.0.0:${PORT}/mcp`);
});
