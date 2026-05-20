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
 * someone else." All three skip paths surface as "no check ran":
 *
 *   - the request had no `mcp-session-id` header (stdio, curl);
 *   - the session was minted without a pin (legacy or stdio-minted);
 *   - the pin matches the header.
 *
 * Returning `null` from `enforceMcpSessionPin` means "let the caller
 * proceed"; returning a non-null wire response means "short-circuit
 * with this `SESSION_NOT_FOUND` payload."
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
  // No header on the request → skip. The design treats absence as
  // "different transport, trust the token alone." (stdio is the
  // canonical case.)
  if (ctx.mcpSessionId === undefined) {
    return null;
  }
  const pin = await ctx.store.readMcpSessionPin(token);
  if (pin === null) {
    // Session was minted without a pin (e.g. stdio-minted, then later
    // accessed over HTTP). The design explicitly does NOT lazily bind
    // the pin on first-with-header access — that would let a bystander
    // claim a session minted over stdio. Skip the check.
    return null;
  }
  if (pin === ctx.mcpSessionId) {
    return null;
  }
  return sessionNotFoundResult(token);
}
