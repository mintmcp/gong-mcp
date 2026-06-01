/**
 * Lightweight Gong API client. Accepts a Bearer token per-call.
 */

import { AsyncLocalStorage } from "node:async_hooks";

const DEFAULT_BASE_URL = "https://us-11711.api.gong.io";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRYABLE_STATUS = new Set([429, 503]);

function requestTimeoutMs(): number {
  const raw = Number(process.env.GONG_REQUEST_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Delay before a retry: honor Retry-After (seconds, capped at 10s) else exp backoff. */
function retryDelayMs(res: Response, attempt: number): number {
  const retryAfter = Number(res.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 10_000);
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

  // Retry only on 429/503: both are pre-processing rejections (rate gate /
  // service unavailable), so the request never reached Gong's handler — safe to
  // retry for any method, including writes. The infinite-for always returns or
  // throws inside the body (no unreachable post-loop code, satisfies tsc).
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url.toString(), { ...init, signal: AbortSignal.timeout(requestTimeoutMs()) });
    } catch (err) {
      const reason = err instanceof Error && err.name === "TimeoutError"
        ? `timed out after ${requestTimeoutMs()}ms`
        : err instanceof Error ? err.message : String(err);
      throw new Error(`Gong API request failed (${opts.method} ${opts.path}): ${reason}`);
    }

    if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_RETRIES) {
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

  const nextPageToken = recordsMeta?.cursor as string | undefined;
  return { records, totalRecords, nextPageToken: nextPageToken || undefined };
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
