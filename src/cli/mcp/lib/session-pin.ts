/**
 * Optional `Mcp-Session-Id` binding for session-mode tools. A mismatched
 * pin surfaces as `SESSION_NOT_FOUND` (404), NOT 403 — the pin is a
 * confidentiality boundary; we don't leak "this session exists but belongs
 * to someone else."
 *
 * Skip (proceed): the session was minted without a pin (stdio mint), or
 * the trimmed pin matches the trimmed header. We do NOT lazily bind on
 * first-with-header access — that would let a bystander claim a
 * stdio-minted session.
 *
 * Reject (SESSION_NOT_FOUND): the session IS pinned and the request omits
 * the header, OR the header is set but doesn't match. Under
 * `--allow-unauthenticated` the token IS the credential, so an HTTP
 * request against a pinned session must carry the header it was bound with.
 */

import type { SessionPinStore } from './session-store';
import { sessionNotFoundResult } from '../tools/result';

export interface PinEnforcement {
  store: SessionPinStore;
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
