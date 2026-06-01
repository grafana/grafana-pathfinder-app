/**
 * Helpers for shaping CallToolResult payloads consistently across tools.
 *
 * Every authoring tool returns its outcome JSON as a single text block. The
 * MCP spec allows mixed content; we pick text-only because:
 *   - JSON in a `text` block is the lowest-common-denominator that every
 *     model client renders sanely;
 *   - `outputSchema` would force us to declare the full CommandOutcome and
 *     handoff shapes in the tool registry, multiplying schema maintenance
 *     for no client win;
 *   - clients that want structured access can JSON.parse the text block —
 *     identical fidelity, simpler contract.
 *
 * Error wire shape is consistent across every code:
 *   `{ status: 'error', code, message, sessionToken?, data? }`
 * Built via the shared `errorResult` factory; the named wrappers below
 * exist so call sites read as the intent (`sessionNotFoundResult(token)`)
 * rather than open-coded code strings.
 */

import type { TreeNode } from '../../utils/package-io';
import { ARTIFACT_ETAG_FIELD, computeArtifactEtag } from '../../utils/etag';
import type { CommandOutcome } from '../../utils/output';
import { SessionStoreUnavailableError } from '../lib/session-store';
import {
  storeUnavailable,
  type ConcurrentModificationResult,
  type SessionTooLargeResult,
  type StoreUnavailableResult,
} from './state-bridge';

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

export function textResult(text: string, isError = false): ToolResult {
  return {
    content: [{ type: 'text', text }],
    ...(isError ? { isError: true } : {}),
  };
}

/**
 * Single error-envelope factory. Every named wrapper below calls this.
 * `sessionToken` is omitted from the payload when undefined; `data` is
 * omitted when undefined. Both are common cases — stateless errors have
 * no token; not every error has structured data.
 */
function errorResult(
  code: string,
  message: string,
  opts: { sessionToken?: string; data?: Record<string, unknown> } = {}
): ToolResult {
  const payload: Record<string, unknown> = { status: 'error', code, message };
  if (opts.sessionToken !== undefined) {
    payload.sessionToken = opts.sessionToken;
  }
  if (opts.data !== undefined) {
    payload.data = opts.data;
  }
  return textResult(JSON.stringify(payload, null, 2), /* isError */ true);
}

/**
 * Render a CommandOutcome (plus an optional artifact echo) as the MCP tool
 * result. The CLI's `CommandOutcome` shape is the wire shape — the MCP does
 * not transform it. This is what makes "schema-illegal output is impossible
 * because it is impossible in the CLI" hold end-to-end: error codes, paths,
 * and structured `data` flow through verbatim.
 *
 * When `artifact` is present, the response wraps it with an `__etag` field
 * (issue #1 — see `src/cli/utils/etag.ts`) sibling to `content` / `manifest`.
 * The agent is expected to echo the artifact back verbatim on subsequent
 * mutation calls including `__etag`; mutation tools check the hash to
 * detect agent-side reformatting before the schema validator runs.
 */
export function outcomeResult(
  outcome: CommandOutcome,
  artifact?: { content: unknown; manifest?: unknown },
  summary?: TreeNode[]
): ToolResult {
  const payload: Record<string, unknown> = { ...outcome };
  if (artifact) {
    payload.artifact = {
      ...artifact,
      [ARTIFACT_ETAG_FIELD]: computeArtifactEtag(artifact),
    };
  }
  if (summary) {
    payload.summary = summary;
  }
  return textResult(JSON.stringify(payload, null, 2), outcome.status === 'error');
}

/**
 * Session-mode mutation ack. The full artifact stays in the bucket; the
 * agent receives only the outcome, sessionToken, generation, and a compact
 * navigation summary. Agents that need the full artifact call
 * `pathfinder_inspect({ sessionToken })`.
 */
export function sessionOutcomeResult(
  sessionToken: string,
  outcome: CommandOutcome,
  generation: number | undefined,
  summary: TreeNode[]
): ToolResult {
  const payload: Record<string, unknown> = { ...outcome, sessionToken, summary };
  if (generation !== undefined) {
    payload.generation = generation;
  }
  return textResult(JSON.stringify(payload, null, 2), outcome.status === 'error');
}

// ── Error wire shapes ────────────────────────────────────────────────────

export function sessionNotFoundResult(sessionToken: string): ToolResult {
  return errorResult(
    'SESSION_NOT_FOUND',
    'No session exists for the provided token. Either the token is wrong, the session expired (7-day TTL), or the session was deleted on finalize. Call pathfinder_create_package to start a new session.',
    { sessionToken }
  );
}

export function concurrentModificationResult(sessionToken: string, result: ConcurrentModificationResult): ToolResult {
  return errorResult(result.code, result.message, {
    sessionToken,
    data: { expected: result.expected, actual: result.actual },
  });
}

export function sessionTooLargeResult(sessionToken: string, result: SessionTooLargeResult): ToolResult {
  return errorResult(result.code, result.message, {
    sessionToken,
    data: { artifactBytes: result.artifactBytes, maxBytes: result.maxBytes },
  });
}

export function invalidSessionTokenResult(): ToolResult {
  return errorResult(
    'INVALID_SESSION_TOKEN',
    'sessionToken is not in the expected format (22 chars, Crockford base32, lowercase). Pass the value you received from pathfinder_create_package or a previous mutation ack verbatim.'
  );
}

export function inputModeAmbiguousResult(): ToolResult {
  return errorResult(
    'INPUT_MODE_AMBIGUOUS',
    'Pass exactly one of `artifact` (stateless mode) or `sessionToken` (session mode). Both were provided.'
  );
}

export function inputModeMissingResult(): ToolResult {
  return errorResult(
    'INPUT_MODE_MISSING',
    'Pass exactly one of `artifact` (stateless mode) or `sessionToken` (session mode). Neither was provided.'
  );
}

/**
 * Wire shape for `SESSION_STORE_UNAVAILABLE` — the backing store rejected
 * the operation for a transient reason (exhausted 429 retries, network
 * blip, auth failure). Returned as a well-formed CommandOutcome so clients
 * never see a raw GCS error string leak through; the original provider
 * error is preserved in server logs via the `cause` chain.
 */
export function storeUnavailableResult(sessionToken: string | undefined, result: StoreUnavailableResult): ToolResult {
  return errorResult(result.code, result.message, { sessionToken, data: { reason: result.reason } });
}

/**
 * Last-line-of-defense envelope for an uncaught throw inside a tool
 * handler. Keeps the wire response a well-formed CommandOutcome so
 * clients can JSON.parse unconditionally; the original error is logged
 * to stderr by the caller.
 */
export function internalErrorResult(sessionToken: string | undefined): ToolResult {
  return errorResult(
    'INTERNAL_ERROR',
    'The server hit an unexpected error handling this request. Retry the operation; if it persists, the server logs contain the underlying cause.',
    { sessionToken }
  );
}

/**
 * Defense-in-depth envelope for tool handlers. Runs `fn` and converts any
 * thrown error into a well-formed CommandOutcome:
 *   - `SessionStoreUnavailableError` → `SESSION_STORE_UNAVAILABLE`
 *   - anything else → `INTERNAL_ERROR` (logged to stderr)
 *
 * Use this at every tool's handler boundary so clients see structured JSON
 * even when something the dispatch layer missed throws. Pass the inbound
 * `sessionToken` so the envelope can echo it back; pass `undefined` for
 * stateless tools.
 */
export async function withToolErrorEnvelope(
  sessionToken: string | undefined,
  toolName: string,
  fn: () => Promise<ToolResult>
): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof SessionStoreUnavailableError) {
      return storeUnavailableResult(sessionToken, storeUnavailable(err));
    }
    console.error(`[${toolName}] uncaught error in tool handler:`, err);
    return internalErrorResult(sessionToken);
  }
}
