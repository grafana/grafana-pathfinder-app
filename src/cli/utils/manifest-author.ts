/**
 * Fills `manifest.author` for every surface that produces a manifest.
 *
 * Missing metadata never blocks anything, so this only fills. Precedence:
 * an explicitly supplied name wins; an author already present is kept unless its
 * name is a fallback placeholder, which a real local identity may replace but the
 * other fallback never does; an absent author becomes the local identity, then
 * `pathfinder-mcp`.
 *
 * `localName` is a thunk so a surface that must not read the host (hosted HTTP)
 * passes nothing, and one that can read it only pays for the read when needed.
 */

import type { Author } from '../../types/package.types';
import { CURRENT_SCHEMA_VERSION } from '../../types/json-guide.schema';
import { isFallbackAuthorName, MCP_FALLBACK_AUTHOR } from '../../types/author-defaults';

export interface AuthorSources {
  supplied?: Author;
  localName?: () => string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

export function resolveAuthor(existing: Author | undefined, sources: AuthorSources = {}): Author {
  const base: Author = isRecord(existing) ? { ...existing } : {};
  const team = nonEmpty(sources.supplied?.team) ?? nonEmpty(base.team);
  const withTeam = (name: string): Author => ({ ...base, name, ...(team !== undefined ? { team } : {}) });

  const supplied = nonEmpty(sources.supplied?.name);
  if (supplied !== undefined) {
    return withTeam(supplied);
  }

  const current = nonEmpty(base.name);
  if (current !== undefined && !isFallbackAuthorName(current)) {
    return withTeam(current);
  }

  const local = nonEmpty(sources.localName?.());
  return withTeam(local ?? current ?? MCP_FALLBACK_AUTHOR);
}

/**
 * The manifest with its author filled. An artifact that never carried a manifest
 * gets the smallest one that is still a valid `manifest.json`, so the author has a
 * place to live; nothing else about it is invented beyond the guide type `create` defaults to.
 */
export function withManifestAuthor(
  manifest: Record<string, unknown> | undefined,
  content: { id?: unknown },
  sources: AuthorSources = {}
): Record<string, unknown> {
  const base: Record<string, unknown> = manifest ?? {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: String(content.id),
    type: 'guide',
  };
  return { ...base, author: resolveAuthor(base.author as Author | undefined, sources) };
}
