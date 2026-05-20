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
import type { ConcurrentModificationResult } from './state-bridge';

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
