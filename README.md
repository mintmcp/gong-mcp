# Gong MCP Server

MCP server for [Gong](https://www.gong.io/) conversation intelligence. Deployed as a hosted HTTP connector on MintMCP.

## Tools

**Read (10)**

| Tool | Description |
|---|---|
| `list_calls` | List calls by date range |
| `get_call` | Get full details for a single call |
| `get_call_transcripts` | Get speaker-segmented transcripts |
| `list_users` | List all users in the Gong account |
| `get_interaction_stats` | Per-call talk ratio, monologue, patience stats |
| `get_aggregate_activity` | Aggregated activity stats (calls, emails, etc.) |
| `list_trackers` | List keyword/phrase trackers |
| `list_call_outcomes` | List call outcome labels |
| `list_workspaces` | List all workspaces |
| `get_users_access_to_calls` | Check who has access to specific calls |

**Write (6)**

| Tool | Description |
|---|---|
| `add_users_access_to_calls` | Grant user access to a call |
| `delete_users_access_to_calls` | Revoke user access from a call |
| `add_call_metadata` | Register a call (metadata only, no audio) |
| `add_meeting` | Create a Gong meeting |
| `update_meeting` | Update an existing meeting |
| `delete_meeting` | Delete a meeting |

## OAuth Scopes

```
api:calls:read:basic,api:calls:read:transcript,api:calls:create,api:users:read,api:stats:interaction,api:stats:user-actions,api:settings:trackers:read,api:call-outcomes:read,api:workspaces:read,api:meetings:user:create,api:meetings:user:update,api:meetings:user:delete
```

| Scope | Used by |
|---|---|
| `api:calls:read:basic` | `list_calls`, `get_call`, `get_users_access_to_calls`, `add_users_access_to_calls`, `delete_users_access_to_calls` |
| `api:calls:read:transcript` | `get_call_transcripts` |
| `api:calls:create` | `add_call_metadata` |
| `api:users:read` | `list_users` |
| `api:stats:interaction` | `get_interaction_stats` |
| `api:stats:user-actions` | `get_aggregate_activity` |
| `api:settings:trackers:read` | `list_trackers` |
| `api:call-outcomes:read` | `list_call_outcomes` |
| `api:workspaces:read` | `list_workspaces` |
| `api:meetings:user:create` | `add_meeting` |
| `api:meetings:user:update` | `update_meeting` |
| `api:meetings:user:delete` | `delete_meeting` |

## Gong OAuth URLs

- **Authorization URL:** `https://app.gong.io/oauth2/authorize`
- **Token URL:** `https://app.gong.io/oauth2/generate-customer-token`

## Deploy

Requires [@mintmcp/hosted-cli](https://www.npmjs.com/package/@mintmcp/hosted-cli).

```bash
# Authenticate
npx @mintmcp/hosted-cli auth login

# First deploy (creates a new connector)
npx @mintmcp/hosted-cli build-and-push \
  --name "Gong" \
  --transport http \
  --dockerfile Dockerfile \
  --context .

# Subsequent deploys (updates existing connector via .mintmcp/hosted.json)
npx @mintmcp/hosted-cli build-and-push \
  --dockerfile Dockerfile \
  --context .
```

After deploying, configure OAuth in the connector settings page returned by the CLI.

## Development

```bash
npm install
npm run build        # TypeScript compile
npm run dev          # Run with tsx (hot reload)
npm start            # Run compiled JS
```

The server listens on port 8000 at `/mcp`. Set `GONG_ACCESS_TOKEN` env var for local testing.
