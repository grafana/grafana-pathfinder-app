/**
 * Deterministic step-ID derivation.
 *
 * Used by the parser and the section orchestrator to produce stable
 * IDs for steps that don't have an author-provided `id`. The hash
 * incorporates the parsed position so that two structurally identical
 * steps in the same section do not collide; explicit `id` should be
 * used by authors who need IDs to survive reordering.
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
