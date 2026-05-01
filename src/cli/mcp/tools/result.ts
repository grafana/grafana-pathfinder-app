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
import type { CommandOutcome } from '../../utils/output';

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
 */
export function outcomeResult(
  outcome: CommandOutcome,
  artifact?: { content: unknown; manifest?: unknown },
  summary?: TreeNode[]
): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  const payload: Record<string, unknown> = { ...outcome };
  if (artifact) {
    payload.artifact = artifact;
  }
  if (summary) {
    payload.summary = summary;
  }
  return textResult(JSON.stringify(payload, null, 2), outcome.status === 'error');
}
