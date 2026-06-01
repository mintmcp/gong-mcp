import { describe, it, expect } from "vitest";
import { resolveAuthorization, extractPage } from "./gong-client.js";

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
});
