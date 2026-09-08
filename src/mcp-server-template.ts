import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerOptions } from "@modelcontextprotocol/sdk/server/index.js";
import type { Implementation } from "@modelcontextprotocol/sdk/types.js";

type RegisterToolArgs = Parameters<McpServer["registerTool"]>;

/**
 * Records tool registrations once at startup and stamps out a fresh McpServer
 * per request via create().
 *
 * Why: the SDK binds one transport per McpServer (connect() throws "Already
 * connected to a transport" while a previous request is in flight) and forbids
 * reusing a stateless StreamableHTTPServerTransport across requests. Both must
 * therefore be created per request; the tool definitions do not.
 */
export class McpServerTemplate {
  private readonly tools: RegisterToolArgs[] = [];

  constructor(
    private readonly serverInfo: Implementation,
    private readonly options?: ServerOptions
  ) {}

  /**
   * Same signature as McpServer.registerTool so call sites keep their inferred
   * handler argument types. The RegisteredTool return value only exists on a
   * live server, so this returns nothing; callers here never use it.
   */
  registerTool = ((...args: RegisterToolArgs) => {
    this.tools.push(args);
  }) as unknown as McpServer["registerTool"];

  /** Build a new, unconnected McpServer with every recorded tool registered. */
  create(): McpServer {
    const server = new McpServer(this.serverInfo, this.options);
    for (const args of this.tools) {
      (server.registerTool as (...a: RegisterToolArgs) => unknown)(...args);
    }
    return server;
  }
}
