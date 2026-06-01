/**
 * Lightweight Gong API client. Accepts a Bearer token per-call.
 */

import { AsyncLocalStorage } from "node:async_hooks";

const DEFAULT_BASE_URL = "https://us-11711.api.gong.io";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRYABLE_STATUS = new Set([429, 503]);
// Upper bound on a single retry wait. Deliberately small: this runs inside a
// synchronous MCP request, so we'd rather fail fast and let the client retry
// than block for a long Retry-After (e.g. a maintenance window).
const MAX_RETRY_DELAY_MS = 10_000;

function requestTimeoutMs(): number {
  const raw = Number(process.env.GONG_REQUEST_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Delay before a retry. Honors Retry-After in both forms allowed by the spec —
 * delta-seconds and HTTP-date — then falls back to exponential backoff. The
 * result is always clamped to MAX_RETRY_DELAY_MS (see its comment).
 */
export function retryDelayMs(res: Response, attempt: number): number {
  const header = res.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
    }
    const dateMs = Date.parse(header);
    if (!Number.isNaN(dateMs)) {
      const delta = dateMs - Date.now();
      if (delta > 0) return Math.min(delta, MAX_RETRY_DELAY_MS);
    }
  }
  return Math.min(500 * 2 ** attempt, 5_000);
}

/** Per-request context carrying the finished Authorization header and optional base URL. */
export interface RequestContext {
  authorization?: string;
  baseUrl?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

/**
 * Build the Authorization header value from whichever credentials are present.
 * Precedence (first match wins):
 *   1. Per-user bearer token from the request  -> Bearer  (canonical OAuth mode)
 *   2. Service-account access key + secret      -> Basic   (shared connection)
 *   3. Shared bearer token from env             -> Bearer  (legacy fallback)
 * Returns undefined when no usable credential is configured.
 */
export function resolveAuthorization(src: {
  headerToken?: string;
  accessKey?: string;
  accessKeySecret?: string;
  envToken?: string;
}): string | undefined {
  if (src.headerToken) return `Bearer ${src.headerToken}`;
  if (src.accessKey && src.accessKeySecret) {
    const encoded = Buffer.from(`${src.accessKey}:${src.accessKeySecret}`).toString("base64");
    return `Basic ${encoded}`;
  }
  if (src.envToken) return `Bearer ${src.envToken}`;
  return undefined;
}

/**
 * Extract a bearer token from an Authorization header value. The auth scheme is
 * case-insensitive per RFC 7235, so "bearer <t>" is accepted as well as
 * "Bearer <t>"; returns undefined for missing, empty, or non-bearer headers.
 */
export function parseBearerToken(authHeader?: string): string | undefined {
  return authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
}

/**
 * Validate a client-supplied Gong base URL. We attach the (potentially shared,
 * org-wide) Gong credential to every outbound request, so an unvalidated base
 * URL from a request header is an SSRF + credential-exfiltration vector. Only
 * accept HTTPS URLs whose host is Gong's API domain; return the bare origin, or
 * undefined if invalid so the caller falls back to a trusted default.
 */
export function sanitizeGongBaseUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    const isGongHost = u.hostname === "api.gong.io" || u.hostname.endsWith(".api.gong.io");
    if (u.protocol !== "https:" || !isGongHost) return undefined;
    return u.origin;
  } catch {
    return undefined;
  }
}

function getContext(): RequestContext {
  const ctx = requestContext.getStore();
  if (!ctx?.authorization) {
    throw new Error(
      "Missing Gong credentials. Provide a per-user OAuth token, or set GONG_ACCESS_KEY + GONG_ACCESS_KEY_SECRET (service account) in your MintMCP connector settings."
    );
  }
  return ctx;
}

export interface GongRequestOptions {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  query?: Record<string, string>;
  body?: unknown;
}

export async function gongRequest(opts: GongRequestOptions): Promise<unknown> {
  const ctx = getContext();
  const baseUrl = ctx.baseUrl || DEFAULT_BASE_URL;
  const url = new URL(opts.path, baseUrl);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }

  const headers: Record<string, string> = { Authorization: ctx.authorization! };
  if (opts.body) headers["Content-Type"] = "application/json";

  const init: RequestInit = {
    method: opts.method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  };

  const timeoutMs = requestTimeoutMs();

  // Retry only on 429/503: both are pre-processing rejections (rate gate /
  // service unavailable), so the request never reached Gong's handler — safe to
  // retry for any method, including writes. The infinite-for always returns or
  // throws inside the body (no unreachable post-loop code, satisfies tsc).
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url.toString(), { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      let reason: string;
      if (err instanceof Error && err.name === "TimeoutError") reason = `timed out after ${timeoutMs}ms`;
      else if (err instanceof Error) reason = err.message;
      else reason = String(err);
      throw new Error(`Gong API request failed (${opts.method} ${opts.path}): ${reason}`);
    }

    if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_RETRIES) {
      // Release the unread body so undici can reuse the connection on retry.
      await res.body?.cancel().catch(() => {});
      await sleep(retryDelayMs(res, attempt));
      continue;
    }
    return handleResponse(res);
  }
}

async function handleResponse(res: Response): Promise<unknown> {
  if (!res.ok) {
    // Gong returns 404 for "no results" — return the response body instead of throwing
    if (res.status === 404) {
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) return res.json();
      return { errors: ["No results found"] };
    }
    const text = await res.text();
    const truncated = text.length > 500 ? text.slice(0, 500) + "..." : text;
    throw new Error(`Gong API ${res.status}: ${truncated}`);
  }
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res.json();
  return res.text();
}

/** Shape a raw Gong paginated response into records + pagination metadata. Pure. */
export function extractPage(
  result: Record<string, unknown>
): { records: unknown[]; totalRecords: number; nextPageToken?: string } {
  const recordsMeta = result.records as Record<string, unknown> | undefined;
  const totalRecords = (recordsMeta?.totalRecords as number) || 0;

  const records: unknown[] = [];
  for (const [key, val] of Object.entries(result)) {
    if (key !== "records" && Array.isArray(val)) records.push(...val);
  }

  return { records, totalRecords, nextPageToken: (recordsMeta?.cursor as string) || undefined };
}

/**
 * Fetch a single page from a Gong paginated endpoint.
 * Pass `cursor` to fetch subsequent pages.
 * Returns the page's records, totalRecords, and nextPageToken (if more pages exist).
 */
export async function gongFetchPage(
  opts: GongRequestOptions & { cursor?: string }
): Promise<{ records: unknown[]; totalRecords: number; nextPageToken?: string }> {
  const { cursor, ...baseOpts } = opts;
  let reqOpts: GongRequestOptions;

  if (baseOpts.method === "GET") {
    const query = { ...baseOpts.query };
    if (cursor) query.cursor = cursor;
    reqOpts = { ...baseOpts, query };
  } else {
    const body = (
      baseOpts.body && typeof baseOpts.body === "object"
        ? { ...(baseOpts.body as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;
    if (cursor) body.cursor = cursor;
    reqOpts = { ...baseOpts, body };
  }

  const result = (await gongRequest(reqOpts)) as Record<string, unknown>;
  return extractPage(result);
}
