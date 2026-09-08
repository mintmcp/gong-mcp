import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { McpServerTemplate } from "./mcp-server-template.js";

const template = new McpServerTemplate({ name: "t", version: "0.0.0" });
template.registerTool(
  "echo",
  { description: "echo", inputSchema: { text: z.string() } },
  async ({ text }) => ({ content: [{ type: "text", text }] })
);

async function connectClient(template: McpServerTemplate) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await template.create().connect(serverTransport);
  const client = new Client({ name: "c", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

describe("McpServerTemplate", () => {
  it("creates independent servers that each expose the recorded tools", async () => {
    const [a, b] = await Promise.all([connectClient(template), connectClient(template)]);
    expect((await a.listTools()).tools.map((t) => t.name)).toEqual(["echo"]);
    expect((await b.listTools()).tools.map((t) => t.name)).toEqual(["echo"]);
    const res = await b.callTool({ name: "echo", arguments: { text: "hi" } });
    expect(res.content).toEqual([{ type: "text", text: "hi" }]);
  });
});
