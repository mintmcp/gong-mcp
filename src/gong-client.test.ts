import { describe, it, expect, vi, afterEach } from "vitest";
import {
  resolveAuthorization,
  extractPage,
  parseBearerToken,
  retryDelayMs,
  sanitizeGongBaseUrl,
  gongRequest,
  gongFetchPage,
  requestContext,
  DEFAULT_BASE_URL,
} from "./gong-client.js";

describe("resolveAuthorization", () => {
  it("prefers a per-user header token (canonical OAuth mode)", () => {
    expect(
      resolveAuthorization({
        headerToken: "user-tok",
        accessKey: "ak",
        accessKeySecret: "sk",
        envToken: "env-tok",
      })
    ).toBe("Bearer user-tok");
  });

  it("uses Basic auth from access key + secret when no header token", () => {
    const encoded = Buffer.from("ak:sk").toString("base64");
    expect(resolveAuthorization({ accessKey: "ak", accessKeySecret: "sk" })).toBe(
      `Basic ${encoded}`
    );
  });

  it("falls back to the shared env bearer token last", () => {
    expect(resolveAuthorization({ envToken: "env-tok" })).toBe("Bearer env-tok");
  });

  it("returns undefined when no credentials are present", () => {
    expect(resolveAuthorization({})).toBeUndefined();
  });

  it("ignores a half-configured service account (key without secret)", () => {
    expect(resolveAuthorization({ accessKey: "ak" })).toBeUndefined();
    expect(resolveAuthorization({ accessKeySecret: "sk" })).toBeUndefined();
  });

  it("falls back to env bearer when service account is half-configured", () => {
    expect(resolveAuthorization({ accessKey: "ak", envToken: "env-tok" })).toBe("Bearer env-tok");
  });
});

describe("extractPage", () => {
  it("flattens sibling data arrays and reads pagination metadata", () => {
    const raw = {
      records: { totalRecords: 42, cursor: "next-cursor" },
      calls: [{ id: "1" }, { id: "2" }],
    };
    expect(extractPage(raw)).toEqual({
      records: [{ id: "1" }, { id: "2" }],
      totalRecords: 42,
      nextPageToken: "next-cursor",
    });
  });

  it("returns no nextPageToken on the last page", () => {
    const raw = { records: { totalRecords: 2 }, users: [{ id: "u1" }, { id: "u2" }] };
    expect(extractPage(raw)).toEqual({
      records: [{ id: "u1" }, { id: "u2" }],
      totalRecords: 2,
      nextPageToken: undefined,
    });
  });

  it("merges multiple sibling arrays and defaults totalRecords to 0", () => {
    const raw = { foo: [{ a: 1 }], bar: [{ b: 2 }] };
    expect(extractPage(raw)).toEqual({
      records: [{ a: 1 }, { b: 2 }],
      totalRecords: 0,
      nextPageToken: undefined,
    });
  });

  it("handles an empty response", () => {
    expect(extractPage({})).toEqual({ records: [], totalRecords: 0, nextPageToken: undefined });
  });

  it("does not treat Gong's errors array as records", () => {
    const raw = { requestId: "r1", errors: ["No calls found corresponding to the provided filters"] };
    expect(extractPage(raw)).toEqual({ records: [], totalRecords: 0, nextPageToken: undefined });
  });
});

describe("gongRequest base URL", () => {
  const okFetch = () =>
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })));
  const requestedUrl = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;

  afterEach(() => vi.unstubAllGlobals());

  it("defaults to Gong's generic API host, not a tenant-specific one", async () => {
    okFetch();
    await requestContext.run({ authorization: "Bearer t" }, () => gongRequest({ method: "GET", path: "/v2/users" }));
    expect(DEFAULT_BASE_URL).toBe("https://api.gong.io");
    expect(requestedUrl()).toBe("https://api.gong.io/v2/users");
  });

  it("uses the per-request base URL when one is set", async () => {
    okFetch();
    await requestContext.run({ authorization: "Bearer t", baseUrl: "https://us-12345.api.gong.io" }, () =>
      gongRequest({ method: "GET", path: "/v2/users" })
    );
    expect(requestedUrl()).toBe("https://us-12345.api.gong.io/v2/users");
  });
});

describe("gongRequest 404 handling", () => {
  const notFoundBody = { requestId: "r1", errors: ["Meeting not found"] };
  const withAuth = <T>(fn: () => Promise<T>) => requestContext.run({ authorization: "Bearer t" }, fn);
  const stubFetch = (status: number, body: string, contentType = "application/json") =>
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status, headers: { "content-type": contentType } })));

  afterEach(() => vi.unstubAllGlobals());

  it("throws on 404 by default, so writes and by-id reads surface a missing target", async () => {
    stubFetch(404, JSON.stringify(notFoundBody));
    await expect(
      withAuth(() => gongRequest({ method: "DELETE", path: "/v2/meetings/nope" }))
    ).rejects.toThrow(/Gong API 404: .*Meeting not found/);
  });

  it("returns the 404 body when notFoundAsEmpty is set", async () => {
    stubFetch(404, JSON.stringify(notFoundBody));
    await expect(
      withAuth(() => gongRequest({ method: "GET", path: "/v2/workspaces", notFoundAsEmpty: true }))
    ).resolves.toEqual(notFoundBody);
  });

  it("returns a placeholder when a notFoundAsEmpty 404 has no JSON body", async () => {
    stubFetch(404, "Not Found", "text/plain");
    await expect(
      withAuth(() => gongRequest({ method: "GET", path: "/v2/workspaces", notFoundAsEmpty: true }))
    ).resolves.toEqual({ errors: ["No results found"] });
  });

  it("gongFetchPage turns a 404 into an empty page", async () => {
    stubFetch(404, JSON.stringify({ requestId: "r1", errors: ["No calls found"] }));
    await expect(
      withAuth(() => gongFetchPage({ method: "GET", path: "/v2/calls", query: {} }))
    ).resolves.toEqual({ records: [], totalRecords: 0, nextPageToken: undefined });
  });

  it("still throws on other error statuses", async () => {
    stubFetch(500, "boom", "text/plain");
    await expect(
      withAuth(() => gongRequest({ method: "GET", path: "/v2/workspaces", notFoundAsEmpty: true }))
    ).rejects.toThrow("Gong API 500: boom");
  });
});

describe("parseBearerToken", () => {
  it("extracts a Bearer token", () => {
    expect(parseBearerToken("Bearer abc123")).toBe("abc123");
  });

  it("is case-insensitive on the scheme", () => {
    expect(parseBearerToken("bearer abc123")).toBe("abc123");
  });

  it("tolerates extra whitespace after the scheme", () => {
    expect(parseBearerToken("Bearer    abc123")).toBe("abc123");
  });

  it("returns undefined for missing, empty, or non-bearer headers", () => {
    expect(parseBearerToken(undefined)).toBeUndefined();
    expect(parseBearerToken("Basic xyz")).toBeUndefined();
    expect(parseBearerToken("Bearer ")).toBeUndefined();
  });
});

describe("retryDelayMs", () => {
  const resWith = (headers: Record<string, string>) => new Response(null, { headers });

  it("honors numeric Retry-After seconds, capped at the max", () => {
    expect(retryDelayMs(resWith({ "retry-after": "3" }), 0)).toBe(3000);
    expect(retryDelayMs(resWith({ "retry-after": "999" }), 0)).toBe(10_000);
  });

  it("parses an HTTP-date Retry-After and clamps to the max", () => {
    const future = new Date(Date.now() + 60_000).toUTCString();
    expect(retryDelayMs(resWith({ "retry-after": future }), 0)).toBe(10_000);
  });

  it("falls back to exponential backoff when no Retry-After is present", () => {
    expect(retryDelayMs(resWith({}), 0)).toBe(500);
    expect(retryDelayMs(resWith({}), 2)).toBe(2000);
  });
});

describe("sanitizeGongBaseUrl", () => {
  it("accepts a regional Gong API host and returns the origin", () => {
    expect(sanitizeGongBaseUrl("https://us-12345.api.gong.io")).toBe("https://us-12345.api.gong.io");
    expect(sanitizeGongBaseUrl("https://us-12345.api.gong.io/v2/calls")).toBe("https://us-12345.api.gong.io");
  });

  it("accepts the bare api.gong.io host", () => {
    expect(sanitizeGongBaseUrl("https://api.gong.io")).toBe("https://api.gong.io");
  });

  it("rejects non-Gong hosts (SSRF / credential-exfil guard)", () => {
    expect(sanitizeGongBaseUrl("https://attacker.example")).toBeUndefined();
    expect(sanitizeGongBaseUrl("https://api.gong.io.attacker.example")).toBeUndefined();
    expect(sanitizeGongBaseUrl("https://notgong.io")).toBeUndefined();
  });

  it("rejects malformed empty-label hosts", () => {
    expect(sanitizeGongBaseUrl("https://.api.gong.io")).toBeUndefined();
    expect(sanitizeGongBaseUrl("https://foo..api.gong.io")).toBeUndefined();
  });

  it("rejects non-default ports but allows explicit 443", () => {
    expect(sanitizeGongBaseUrl("https://api.gong.io:8443")).toBeUndefined();
    expect(sanitizeGongBaseUrl("https://us-12345.api.gong.io:9443")).toBeUndefined();
    expect(sanitizeGongBaseUrl("https://api.gong.io:443")).toBe("https://api.gong.io");
  });

  it("rejects non-HTTPS schemes", () => {
    expect(sanitizeGongBaseUrl("http://us-12345.api.gong.io")).toBeUndefined();
    expect(sanitizeGongBaseUrl("file:///etc/passwd")).toBeUndefined();
  });

  it("rejects missing or malformed input", () => {
    expect(sanitizeGongBaseUrl(undefined)).toBeUndefined();
    expect(sanitizeGongBaseUrl("")).toBeUndefined();
    expect(sanitizeGongBaseUrl("not a url")).toBeUndefined();
  });
});
