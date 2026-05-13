/**
 * Artifact integrity (M2 — issue #1 in
 * [`docs/design/MCP-AGENT-UX-HARDENING.md`](../../../docs/design/MCP-AGENT-UX-HARDENING.md)).
 *
 * Computes a deterministic short hex digest over `{content, manifest}` so
 * the MCP layer can detect agent-corrupted artifacts before they reach
 * the schema validator. Without this, a subtle agent-side reformat (e.g.,
 * wrapping a markdown `content` string in an array) surfaces as a generic
 * `SCHEMA_VALIDATION` failure that the agent self-diagnoses as "I
 * misread the schema" instead of "I broke the round-trip contract."
 *
 * **Design notes:**
 *
 * - The etag lives at the artifact-envelope level (`artifact.__etag`),
 *   sibling to `content` and `manifest`. It is never inside `content`,
 *   and it is never passed to the CLI runner — the state-bridge strips
 *   it before writing to tmpdir.
 *
 * - The hash is computed over **canonical-form JSON** (sorted keys at
 *   every depth) so two semantically-equivalent serializations of the
 *   same artifact produce the same etag. This is what makes the agent's
 *   "verbatim round-trip" contract robust to whitespace and key-order
 *   shuffling that any well-behaved JSON library might introduce.
 *
 * - SHA-256, truncated to 16 hex chars (64 bits). Plenty of entropy for
 *   collision avoidance within an authoring session; short enough not
 *   to bloat responses. Not security-relevant — this is an integrity
 *   check against agent reformatting, not against adversarial attack.
 */

import * as crypto from 'node:crypto';

const ETAG_LENGTH_CHARS = 16;

/**
 * Sentinel name of the etag field on the artifact envelope. Centralized
 * here so callers can `import { ARTIFACT_ETAG_FIELD }` instead of typing
 * the literal string in multiple places.
 */
export const ARTIFACT_ETAG_FIELD = '__etag' as const;

/**
 * Compute the deterministic short digest for an artifact. The input is
 * the artifact's content (`{content, manifest}`); the envelope-level
 * `__etag` field is **never** included in the hash input.
 *
 * Calling `computeArtifactEtag` twice on the same logical artifact —
 * including across re-serializations or key-order shuffles — produces
 * the same digest.
 */
export function computeArtifactEtag(input: { content: unknown; manifest?: unknown }): string {
  const canonical = canonicalize({
    content: input.content,
    // Normalize `undefined` to absence so a passed-in `undefined` manifest
    // hashes the same as one that wasn't provided at all.
    ...(input.manifest !== undefined ? { manifest: input.manifest } : {}),
  });
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, ETAG_LENGTH_CHARS);
}

/**
 * Pull `__etag` off the wire-level artifact envelope and return the
 * payload (`{content, manifest}`) without it. Used by mutation tools so
 * the etag check happens at the MCP layer and the CLI runner never sees
 * the envelope field.
 *
 * If `__etag` is absent (older client, first call before any etag was
 * issued), `etag` is `undefined` and the caller should skip the
 * integrity check.
 */
export function splitArtifactEtag<T extends { content: unknown; manifest?: unknown }>(
  artifact: T & { __etag?: unknown }
): { etag: string | undefined; payload: { content: unknown; manifest?: unknown } } {
  const { __etag, ...rest } = artifact as Record<string, unknown> & {
    __etag?: unknown;
    content: unknown;
    manifest?: unknown;
  };
  return {
    etag: typeof __etag === 'string' ? __etag : undefined,
    payload: { content: rest.content, manifest: rest.manifest },
  };
}

// ---------------------------------------------------------------------------
// canonical JSON
// ---------------------------------------------------------------------------

/**
 * Render any JSON-serializable value to a canonical string with object
 * keys sorted alphabetically at every depth. Arrays preserve order
 * (semantically meaningful in a guide artifact). Non-finite numbers and
 * functions are out of scope — the artifact is JSON to begin with.
 */
function canonicalize(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    const body = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',');
    return `{${body}}`;
  }
  // `undefined`, symbols, functions — JSON would drop these; do the same.
  return 'null';
}
