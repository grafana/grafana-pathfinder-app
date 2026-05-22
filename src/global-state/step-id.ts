/**
 * Deterministic step-ID derivation.
 *
 * Anonymous interactive blocks (no author-supplied `id`) used to be
 * keyed by a module-scope monotonic counter — `standalone-step-N`,
 * `terminal-step-N`, etc. Across full reloads or remounts, the counter
 * incrementation order depended on render order, so the same content
 * could land on different IDs and orphan its prior progress in
 * `interactiveStepStorage`.
 *
 * `deriveStepId` produces a stable, position+content-aware key from the
 * parser's own knowledge:
 *   - `sectionId` — owning section (or a synthetic standalone group).
 *   - `index`     — zero-based position within the parent block array.
 *   - `action`    — `targetAction` when present.
 *   - `refTarget` — `refTarget` when present.
 *   - `variant`   — optional sub-step discriminator (e.g. multi-step
 *                   child index).
 *
 * Two structurally identical anonymous blocks at the same parser index
 * collide by design; authors who care about that case set an explicit
 * `id`. The hash incorporates `index` so reordering disambiguates.
 *
 * Lives in `global-state/` (Tier 1) so the parser (`docs-retrieval`,
 * Tier 2) and the step components (`components/`, Tier 4) can both
 * import it without a tier violation.
 */

function djb2Hash(input: string): number {
  // DJB2 — short, deterministic, no dependencies. The xor variant
  // (33 * h ^ c) distributes short strings better than the additive form.
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  return hash >>> 0;
}

export interface DeriveStepIdInput {
  /** Section ID the step lives under, or a synthetic value for standalone steps. */
  sectionId: string;
  /** Zero-based position within the parent. */
  index: number;
  /** The `targetAction` value when present. */
  action?: string;
  /** The `refTarget` value when present. */
  refTarget?: string;
  /** Optional discriminant for sub-step blocks (e.g. multistep children). */
  variant?: string;
}

/**
 * Build a stable ID from the step's parsed identity. Two calls with
 * the same inputs return the same ID; any field change produces a
 * different ID.
 */
export function deriveStepId(input: DeriveStepIdInput): string {
  const seed = [
    input.sectionId,
    String(input.index),
    input.action ?? '',
    input.refTarget ?? '',
    input.variant ?? '',
  ].join('|');
  const hash = djb2Hash(seed).toString(36);
  return `${input.sectionId}-step-${hash}`;
}
