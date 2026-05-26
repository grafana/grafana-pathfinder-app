/**
 * Access-log data shape and helpers for the HTTP transport.
 *
 * Extracted from `http.ts` so the transport core (server wiring,
 * concurrency gate, request handler, wallclock timer, byte-counting
 * wrappers) stays focused on transport mechanics. Per-request byte
 * counting and the `finish` closure remain in `http.ts` — they bind to
 * the request handler's local state and don't extract cleanly.
 */

import { isValidSessionToken, normalizeSessionToken, tokenLogHash, tokenLogPrefix } from '../lib/session-token';

export interface AccessLogEntry {
  ts: string;
  remote: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  bytesIn: number;
  bytesOut: number;
  /**
   * Heuristic token estimate: ceil(bytes / 4). Rough lower bound for
   * English/JSON tokens under common BPE tokenizers; over-estimates for
   * CJK / base64 / random binary. Useful for spotting outliers; not
   * authoritative for billing.
   */
  tokensInEstimate: number;
  tokensOutEstimate: number;
  outcome: 'ok' | 'too_large' | 'bad_json' | 'overloaded' | 'timeout' | 'not_found' | 'error';
  /**
   * JSON-RPC method from the parsed request body (e.g. "tools/call",
   * "tools/list", "initialize"). Absent for non-RPC requests (healthcheck,
   * 404s, malformed bodies). For batch requests the value is "batch".
   */
  rpcMethod?: string;
  /**
   * For `tools/call` requests, the `params.name` value (e.g.
   * "pathfinder_add_block"). Lets us break token spend down by tool, which
   * the HTTP-level `path` field cannot — every tool call hits `/mcp`.
   */
  rpcToolName?: string;
  /**
   * Echoed JSON-RPC id, for cross-correlating client logs with server logs.
   * Strings, numbers, and null are preserved as-is; objects/arrays are
   * dropped to keep the log line tidy.
   */
  rpcId?: string | number | null;
  /** Number of envelopes in a batch request. Absent for single requests. */
  batchSize?: number;
  /**
   * Stable short hash of the client's `mcp-session-id` header, when
   * supplied. Lets us reconstruct an authoring run end-to-end without
   * logging the raw header — the same header value is persisted as the
   * session pin (see `lib/session-pin.ts`) and is therefore confidentiality
   * material. A log reader who also held the bearer token could otherwise
   * replay the pin from logs. Clustering by remote IP fails as soon as
   * two clients share egress NAT, so the hash earns its keep.
   */
  sessionIdHash?: string;
  /**
   * Hop count within this MCP session. Increments only on `tools/call`,
   * so `initialize`, `tools/list`, and SSE polls do not bump it. Lets us
   * plot tokens-per-hop curves directly per session.
   */
  sessionHopCount?: number;
  /**
   * Byte length of the JSON-stringified `args.artifact` on tools/call
   * requests that carry an artifact. The artifact-only number is the
   * apples-to-apples signal for O(N²) reasoning; `bytesIn` includes the
   * full JSON-RPC envelope and tool-args wrapper.
   */
  artifactBytesIn?: number;
  /**
   * Byte length of the JSON-stringified artifact echoed back in the tool
   * result. Absent for tools that don't return an artifact.
   */
  artifactBytesOut?: number;
  /**
   * True when the resolved tool result had `isError: true`. The HTTP
   * envelope is still 200 in that case (and `outcome` stays `ok`), so
   * without this field the log can't surface tool-level rejection.
   */
  toolError?: boolean;
  /**
   * `CommandOutcome.status` from the structured tool result, when
   * recognizable (most authoring tools wrap the CLI's CommandOutcome
   * verbatim via `outcomeResult`). Best-effort.
   */
  toolStatus?: string;
  /**
   * First 12 chars of the session token in args, when this tool call
   * carries one (P7 session-mode). Recognizable for humans without
   * being a usable credential. Raw tokens never appear in the log.
   * See `lib/session-token.ts#tokenLogPrefix`.
   */
  sessionTokenPrefix?: string;
  /**
   * Short SHA-256-derived hash of the session token, for stable
   * correlation across log lines without the human-readability of the
   * prefix. See `lib/session-token.ts#tokenLogHash`.
   */
  sessionTokenHash?: string;
}

export interface RpcInfo {
  rpcMethod?: string;
  rpcToolName?: string;
  rpcId?: string | number | null;
  batchSize?: number;
  sessionTokenPrefix?: string;
  sessionTokenHash?: string;
}

/**
 * Extract JSON-RPC method, tool name, and id from a parsed request body.
 *
 * Defensive: the body is `unknown` here (it has only been JSON.parsed, not
 * validated). Any shape we don't recognize returns an empty object so the
 * log line still emits with the standard fields.
 */
export function extractRpcInfo(body: unknown): RpcInfo {
  if (Array.isArray(body)) {
    // JSON-RPC batch. Surface the size; individual methods would clutter
    // the log line and batches are rare in practice for this server.
    return { rpcMethod: 'batch', batchSize: body.length };
  }
  if (!body || typeof body !== 'object') {
    return {};
  }
  const obj = body as { method?: unknown; id?: unknown; params?: unknown };
  const info: RpcInfo = {};
  if (typeof obj.method === 'string') {
    info.rpcMethod = obj.method;
  }
  if (typeof obj.id === 'string' || typeof obj.id === 'number' || obj.id === null) {
    info.rpcId = obj.id;
  }
  if (info.rpcMethod === 'tools/call' && obj.params && typeof obj.params === 'object') {
    const params = obj.params as { name?: unknown; arguments?: unknown };
    if (typeof params.name === 'string') {
      info.rpcToolName = params.name;
    }
    // P7 task 17 — surface session-token-derived correlators in the
    // access log so an operator can trace one authoring session across
    // hops without ever logging the raw token. Best-effort: any shape
    // we don't recognize is silently skipped.
    if (params.arguments && typeof params.arguments === 'object') {
      const raw = (params.arguments as { sessionToken?: unknown }).sessionToken;
      if (typeof raw === 'string') {
        const token = normalizeSessionToken(raw);
        if (token !== null && isValidSessionToken(token)) {
          info.sessionTokenPrefix = tokenLogPrefix(token);
          info.sessionTokenHash = tokenLogHash(token);
        }
      }
    }
  }
  return info;
}

/** Heuristic char-to-token estimate. See AccessLogEntry doc. */
export function estimateTokens(bytes: number): number {
  return Math.ceil(bytes / 4);
}

/** Default access-log writer: one structured JSON line per request to stderr. */
export const defaultLog = (entry: AccessLogEntry): void => {
  process.stderr.write(JSON.stringify(entry) + '\n');
};
