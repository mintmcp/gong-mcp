import { describe, it, expect } from "vitest";
import { resolveAuthorization } from "./gong-client.js";

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
