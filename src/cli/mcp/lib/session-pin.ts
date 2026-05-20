/**
 * P7 task 16 — optional `Mcp-Session-Id` binding for session-mode tools.
 *
 * The HTTP transport extracts the `Mcp-Session-Id` request header (see
 * `transports/http.ts#readSessionId`) and the build chain plumbs it into
 * every per-request `McpServer` via `BuildServerOptions.mcpSessionId`.
 * On session mint, callers persist the value as a pin in the session
 * store; on every subsequent session-mode call the pin is compared
 * against the current request's header.
 *
 * Per the P7 design: a mismatched pin surfaces as `SESSION_NOT_FOUND`
 * (the wire-shape 404), NOT a forbidden 403. The pin is a confidentiality
 * boundary — we don't want to leak "this session exists but belongs to
 * someone else."
 *
 * Skip paths (pin check returns null = proceed):
 *
 *   - the session was minted without a pin (stdio mint, no header at
 *     mint time). Without a pin there is nothing to enforce, and we do
 *     NOT lazily bind on first-with-header access (that would let a
 *     bystander claim a stdio-minted session).
 *   - the trimmed pin matches the trimmed header.
 *
 * Reject paths (return SESSION_NOT_FOUND):
 *
 *   - the session IS pinned and the request omits the header. The
 *     pre-WR-01 implementation skipped this case, which made the pin
 *     trivially bypassable on HTTP — any token-bearer could omit the
 *     header and slip past. Under `--allow-unauthenticated` the token
 *     IS the credential, so an HTTP request against a pinned session
 *     must carry the header it was bound with.
 *   - the session IS pinned and the header is set but doesn't match.
 *
 * stdio compatibility: stdio-minted sessions are minted without a
 * header, so `readMcpSessionPin` returns null and we proceed without
 * enforcement. The skip is driven by "is this session pinned?" rather
 * than "did the request carry a header?" — closing the bypass without
 * threading transport identity through the build chain.
 */

import type { SessionStore } from './session-store';
import { sessionNotFoundResult } from '../tools/result';

export interface PinEnforcement {
  store: SessionStore;
  /**
   * Transport-layer Mcp-Session-Id for the current request, if any.
   * Stdio passes undefined; HTTP passes the request header value or
   * undefined when the client omits it.
   */
  mcpSessionId: string | undefined;
}

/**
 * Returns `null` to proceed, or a wire-shape `SESSION_NOT_FOUND`
 * response when the pin check fails. The token is assumed to be
 * already normalized.
 */
export async function enforceMcpSessionPin(
  ctx: PinEnforcement,
  token: string
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean } | null> {
  const pin = await ctx.store.readMcpSessionPin(token);
  if (pin === null) {
    // Unpinned session — nothing to enforce. Covers the stdio mint case
    // and any pre-pin legacy data.
    return null;
  }
  // Session IS pinned. The request MUST carry a matching header.
  if (ctx.mcpSessionId === undefined) {
    return sessionNotFoundResult(token);
  }
  if (pin.trim() === ctx.mcpSessionId.trim()) {
    return null;
  }
  return sessionNotFoundResult(token);
}
