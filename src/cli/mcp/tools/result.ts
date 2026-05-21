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
 */

import type { TreeNode } from '../../utils/package-io';
import { ARTIFACT_ETAG_FIELD, computeArtifactEtag } from '../../utils/etag';
import type { CommandOutcome } from '../../utils/output';
import { SessionStoreUnavailableError } from '../lib/session-store';
import type {
  ConcurrentModificationResult,
  SessionHopLimitResult,
  SessionTooLargeResult,
  StoreUnavailableResult,
} from './state-bridge';

export function textResult(
  text: string,
  isError = false
): {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
} {
  return {
    content: [{ type: 'text', text }],
    ...(isError ? { isError: true } : {}),
  };
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
): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
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
 * agent receives only:
 *
 *   - `sessionToken` — echo on the next call.
 *   - `generation` — for optional `expectedGeneration` on the next call.
 *   - `outcome` — the CLI's `CommandOutcome` verbatim (summary + any
 *     structured error fields).
 *   - `summary` — compact navigation tree of the post-mutation artifact,
 *     so the agent does not need to immediately call
 *     `pathfinder_list_blocks` after every mutation.
 *
 * No artifact body, no `__etag` — both are absent by design. Agents that
 * need the full artifact call `pathfinder_inspect({ sessionToken })`.
 */
export function sessionOutcomeResult(
  sessionToken: string,
  outcome: CommandOutcome,
  generation: number | undefined,
  summary: TreeNode[]
): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  const payload: Record<string, unknown> = {
    ...outcome,
    sessionToken,
    summary,
  };
  if (generation !== undefined) {
    payload.generation = generation;
  }
  return textResult(JSON.stringify(payload, null, 2), outcome.status === 'error');
}

/** Wire shape for `SESSION_NOT_FOUND` returned by session-mode tools. */
export function sessionNotFoundResult(sessionToken: string): {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
} {
  const payload = {
    status: 'error' as const,
    code: 'SESSION_NOT_FOUND',
    message:
      'No session exists for the provided token. Either the token is wrong, the session expired (7-day TTL), or the session was deleted on finalize. Call pathfinder_create_package to start a new session.',
    sessionToken,
  };
  return textResult(JSON.stringify(payload, null, 2), /* isError */ true);
}

/** Wire shape for `CONCURRENT_MODIFICATION` returned by session-mode tools. */
export function concurrentModificationResult(
  sessionToken: string,
  result: ConcurrentModificationResult
): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  const payload = {
    status: 'error' as const,
    code: result.code,
    message: result.message,
    sessionToken,
    data: {
      expected: result.expected,
      actual: result.actual,
    },
  };
  return textResult(JSON.stringify(payload, null, 2), /* isError */ true);
}

/**
 * Wire shape for `SESSION_TOO_LARGE` — the artifact would exceed the
 * server-side per-session size cap. The cap is documented on
 * `MAX_SESSION_ARTIFACT_BYTES`. Surfaced as an error so the agent
 * stops appending; the prior valid state is unchanged.
 */
export function sessionTooLargeResult(
  sessionToken: string,
  result: SessionTooLargeResult
): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  const payload = {
    status: 'error' as const,
    code: result.code,
    message: result.message,
    sessionToken,
    data: {
      artifactBytes: result.artifactBytes,
      maxBytes: result.maxBytes,
    },
  };
  return textResult(JSON.stringify(payload, null, 2), /* isError */ true);
}

/**
 * Wire shape for `SESSION_HOP_LIMIT` — the per-replica successful-save
 * cap has been hit. Defense-in-depth against runaway agents; see
 * `MAX_SESSION_SAVES` for the per-replica reasoning.
 */
export function sessionHopLimitResult(
  sessionToken: string,
  result: SessionHopLimitResult
): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  const payload = {
    status: 'error' as const,
    code: result.code,
    message: result.message,
    sessionToken,
    data: {
      saves: result.saves,
      maxSaves: result.maxSaves,
    },
  };
  return textResult(JSON.stringify(payload, null, 2), /* isError */ true);
}

/** Wire shape for invalid session token format. */
export function invalidSessionTokenResult(): {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
} {
  return textResult(
    JSON.stringify(
      {
        status: 'error' as const,
        code: 'INVALID_SESSION_TOKEN',
        message:
          'sessionToken is not in the expected format (22 chars, Crockford base32, lowercase). Pass the value you received from pathfinder_create_package or a previous mutation ack verbatim.',
      },
      null,
      2
    ),
    /* isError */ true
  );
}

/** Wire shape for "must pass exactly one of {artifact} or {sessionToken}". */
export function inputModeAmbiguousResult(): {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
} {
  return textResult(
    JSON.stringify(
      {
        status: 'error' as const,
        code: 'INPUT_MODE_AMBIGUOUS',
        message:
          'Pass exactly one of `artifact` (stateless mode) or `sessionToken` (session mode). Both were provided.',
      },
      null,
      2
    ),
    /* isError */ true
  );
}

/**
 * Wire shape for `SESSION_STORE_UNAVAILABLE` — the backing store rejected
 * the operation for a transient reason (exhausted 429 retries, network
 * blip, auth failure). Returned as a well-formed CommandOutcome so clients
 * never see a raw GCS error string leak through; the original provider
 * error is preserved in server logs via the `cause` chain.
 */
export function storeUnavailableResult(
  sessionToken: string | undefined,
  result: StoreUnavailableResult
): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  const payload = {
    status: 'error' as const,
    code: result.code,
    message: result.message,
    ...(sessionToken !== undefined ? { sessionToken } : {}),
    data: { reason: result.reason },
  };
  return textResult(JSON.stringify(payload, null, 2), /* isError */ true);
}

/**
 * Wire shape for an unexpected error inside a tool handler. Last line of
 * defense against any throw that escapes the dispatch layer — keeps the
 * wire response a well-formed CommandOutcome so clients can JSON.parse
 * unconditionally. The original error is logged to stderr by the caller.
 */
export function internalErrorResult(sessionToken: string | undefined): {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
} {
  const payload = {
    status: 'error' as const,
    code: 'INTERNAL_ERROR',
    message:
      'The server hit an unexpected error handling this request. Retry the operation; if it persists, the server logs contain the underlying cause.',
    ...(sessionToken !== undefined ? { sessionToken } : {}),
  };
  return textResult(JSON.stringify(payload, null, 2), /* isError */ true);
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
  fn: () => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof SessionStoreUnavailableError) {
      return storeUnavailableResult(sessionToken, {
        ok: false,
        code: 'SESSION_STORE_UNAVAILABLE',
        reason: err.reason,
        message: err.message,
      });
    }
    console.error(`[${toolName}] uncaught error in tool handler:`, err);
    return internalErrorResult(sessionToken);
  }
}

export function inputModeMissingResult(): {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
} {
  return textResult(
    JSON.stringify(
      {
        status: 'error' as const,
        code: 'INPUT_MODE_MISSING',
        message:
          'Pass exactly one of `artifact` (stateless mode) or `sessionToken` (session mode). Neither was provided.',
      },
      null,
      2
    ),
    /* isError */ true
  );
}
