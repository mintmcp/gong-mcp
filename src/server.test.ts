import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { app } from "./server.js";

/**
 * Stub Gong backend: answers every request after `delayMs` and records the
 * Authorization header it saw, so tests can assert per-request isolation.
 */
function startStubGong(delayMs: number) {
  const seenAuth: string[] = [];
  const server = http.createServer((req, res) => {
    seenAuth.push(req.headers.authorization ?? "");
    setTimeout(() => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ requestId: "stub", workspaces: [{ id: "ws-1", name: "stub" }] }));
    }, delayMs);
  });
  return new Promise<{ url: string; seenAuth: string[]; close: () => void }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, seenAuth, close: () => server.close() });
    });
  });
}

function startApp() {
  const httpServer = app.listen(0, "127.0.0.1");
  return new Promise<{ url: string; close: () => void }>((resolve) => {
    httpServer.on("listening", () => {
      const { port } = httpServer.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}/mcp`, close: () => httpServer.close() });
    });
  });
}

/** POST one JSON-RPC tools/call and return the decoded result from the SSE body. */
async function callTool(url: string, token: string, name: string, args: Record<string, unknown> = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const text = await res.text();
  const data = text.match(/^data: (.*)$/m)?.[1];
  return { status: res.status, rpc: data ? JSON.parse(data) : undefined, text };
}

describe("POST /mcp under concurrent requests", () => {
  let stub: Awaited<ReturnType<typeof startStubGong>>;
  let server: Awaited<ReturnType<typeof startApp>>;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    stub = await startStubGong(300);
    process.env.GONG_BASE_URL = stub.url;
    delete process.env.GONG_ACCESS_KEY;
    delete process.env.GONG_ACCESS_KEY_SECRET;
    delete process.env.GONG_ACCESS_TOKEN;
    server = await startApp();
  });

  afterAll(() => {
    server.close();
    stub.close();
    process.env = savedEnv;
  });

  it("serves overlapping tool calls without 'Already connected to a transport' failures", async () => {
    // Regression: a module-level McpServer shared across requests made every
    // request after the first fail with HTTP 500 while a tool call was in flight.
    const n = 5;
    const results = await Promise.all(
      Array.from({ length: n }, (_, i) => callTool(server.url, `tok-${i}`, "list_workspaces"))
    );

    for (const r of results) {
      expect(r.status, r.text).toBe(200);
      expect(r.rpc?.error, r.text).toBeUndefined();
      expect(r.rpc?.result?.isError, r.text).toBeFalsy();
      expect(r.rpc?.result?.content?.[0]?.text).toContain("ws-1");
    }
    expect(stub.seenAuth.length).toBe(n);
  });

  it("keeps each request's credentials isolated across overlapping requests", async () => {
    stub.seenAuth.length = 0;
    const tokens = ["alpha", "beta", "gamma"];
    await Promise.all(tokens.map((t) => callTool(server.url, t, "list_workspaces")));
    expect(stub.seenAuth.sort()).toEqual(tokens.map((t) => `Bearer ${t}`).sort());
  });
});

describe("server instructions", () => {
  let server: Awaited<ReturnType<typeof startApp>>;
  beforeAll(async () => {
    server = await startApp();
  });
  afterAll(() => server.close());

  async function rpc(method: string, params: Record<string, unknown>) {
    const res = await fetch(server.url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return JSON.parse((await res.text()).match(/^data: (.*)$/m)![1]).result;
  }

  it("only mentions tools that are actually registered", async () => {
    const init = await rpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "0.0.0" },
    });
    const registered = new Set((await rpc("tools/list", {})).tools.map((t: { name: string }) => t.name));
    // snake_case identifiers in the prose are tool names; every one must exist.
    const mentioned = [...new Set(String(init.instructions).match(/\b[a-z]+(?:_[a-z]+)+\b/g))];
    expect(mentioned.length).toBeGreaterThan(0);
    expect(mentioned.filter((name) => !registered.has(name))).toEqual([]);
  });
});

describe("HTTP surface", () => {
  let server: Awaited<ReturnType<typeof startApp>>;
  beforeAll(async () => {
    server = await startApp();
  });
  afterAll(() => server.close());

  const origin = () => server.url.replace(/\/mcp$/, "");

  it("answers GET and DELETE /mcp with a JSON-RPC 405 and an Allow header", async () => {
    for (const method of ["GET", "DELETE"]) {
      const res = await fetch(server.url, { method });
      expect(res.status, method).toBe(405);
      expect(res.headers.get("allow"), method).toBe("POST");
      expect(await res.json()).toEqual({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed." },
        id: null,
      });
    }
  });

  it("serves GET /health", async () => {
    const res = await fetch(`${origin()}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("does not advertise Express via X-Powered-By", async () => {
    const res = await fetch(`${origin()}/health`);
    expect(res.headers.get("x-powered-by")).toBeNull();
  });
});

