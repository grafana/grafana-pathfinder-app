/**
 * Projects a source `manifest.json` onto a CRD-valid `spec.manifest`.
 *
 * The `InteractiveGuide` CRD types only a subset of what a package manifest
 * carries, so a straight copy would either be pruned by the API server or
 * rejected. This mirrors `build_manifest` in
 * `scripts/upsert-learning-path.sh` — the one other writer of `spec.manifest`
 * — so both entry points put the same bytes on the wire:
 *
 * - the CRD-typed keys verbatim, dropping ones that are absent or empty,
 * - `depends` widened from bare IDs to CNF singleton clauses,
 * - `milestones` only for the meta types that may declare them,
 * - everything else swept into `additionalFields`, the CRD's escape hatch,
 *   so no authored field is silently lost on the way in.
 *
 * `id` is deliberately not emitted: the resource name carries it.
 */

/** Keys the CRD declares on `spec.manifest`, plus `id`, which the resource name carries. */
const CRD_TYPED_KEYS = ['id', 'type', 'repository', 'description', 'milestones', 'author', 'category', 'depends'];

/** The CRD's `#Author` declares only these two; anything else sweeps into `additionalFields`. */
const CRD_AUTHOR_KEYS = ['name', 'team'];

/** Only these package types may declare milestones (`package.schema.ts` Rule 2). */
const META_TYPES = ['path', 'journey'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Drops keys whose value is null or undefined, matching jq's `select(.value != null)`. */
function withoutNullish(source: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== null && value !== undefined));
}

function pick(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([key]) => keys.includes(key)));
}

function omit(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !keys.includes(key)));
}

/**
 * Widens `depends` to CNF: the CRD holds every clause as an array of
 * alternatives, so a bare package ID becomes a singleton clause.
 */
function toCnfClauses(depends: unknown): string[][] {
  if (!Array.isArray(depends)) {
    return [];
  }
  return depends.map((clause) => (Array.isArray(clause) ? (clause as string[]) : [clause as string]));
}

/**
 * Maps a source manifest onto the CRD's `spec.manifest` shape.
 *
 * @param manifest the artifact's manifest, as authored
 * @returns the projected manifest, or `undefined` when there is nothing to emit
 */
export function projectManifestForCrd(manifest: unknown): Record<string, unknown> | undefined {
  if (!isRecord(manifest)) {
    return undefined;
  }

  const present = withoutNullish(manifest);

  const allAuthor = isRecord(present.author) ? withoutNullish(present.author) : {};
  const author = pick(allAuthor, CRD_AUTHOR_KEYS);
  const authorExtra = omit(allAuthor, CRD_AUTHOR_KEYS);

  // Untyped keys, plus any author sub-key the CRD's #Author does not declare.
  const extra: Record<string, unknown> = {
    ...omit(present, CRD_TYPED_KEYS),
    ...(Object.keys(authorExtra).length > 0 ? { author: authorExtra } : {}),
  };

  const milestones = Array.isArray(present.milestones) ? present.milestones : [];
  const isMeta = typeof present.type === 'string' && META_TYPES.includes(present.type);
  const depends = toCnfClauses(present.depends);
  const repository = typeof present.repository === 'string' ? present.repository : '';

  const projected: Record<string, unknown> = {
    ...(present.type !== undefined ? { type: present.type } : {}),
    ...(repository !== '' ? { repository } : {}),
    ...(present.description !== undefined ? { description: present.description } : {}),
    ...(present.category !== undefined ? { category: present.category } : {}),
    ...(Object.keys(author).length > 0 ? { author } : {}),
    ...(isMeta && milestones.length > 0 ? { milestones } : {}),
    ...(depends.length > 0 ? { depends } : {}),
    ...(Object.keys(extra).length > 0 ? { additionalFields: extra } : {}),
  };

  return Object.keys(projected).length > 0 ? projected : undefined;
}
