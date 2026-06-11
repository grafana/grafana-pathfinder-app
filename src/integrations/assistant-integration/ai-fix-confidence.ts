import { querySelectorAllEnhanced, resolveSelector } from '../../lib/dom';
import type { AiFixPatch } from './ai-fix-patch.schema';

export type ConfidenceResult = { ok: true } | { ok: false; reason: string };

/**
 * Gate deciding whether an AI-proposed patch may be written into a guide.
 * Accepts iff the patch's proposed selector resolves to ≥ 1 element in the
 * live DOM (via the same resolve → enhanced-query pipeline the engine uses at
 * execution time), so the requirement re-check lands on a real target. There
 * is no token/similarity check — a correct fix often shares no tokens with the
 * failing selector.
 */
export function evaluatePatchConfidence(patch: AiFixPatch): ConfidenceResult {
  const proposedSelector = patch.type === 'prepend-step' ? (patch.newStep.reftarget ?? '') : patch.newReftarget;

  // A prepend-step without a reftarget is purely instructional — no DOM target to verify.
  if (patch.type === 'prepend-step' && !proposedSelector) {
    return { ok: true };
  }
  if (!proposedSelector) {
    return { ok: false, reason: 'patch has no selector to verify' };
  }
  // Server / test context with no DOM — skip verification rather than reject.
  if (typeof document === 'undefined') {
    return { ok: true };
  }

  const resolved = resolveSelector(proposedSelector);
  const matchCount = querySelectorAllEnhanced(resolved).elements.length;
  if (matchCount === 0) {
    return { ok: false, reason: 'proposed selector does not match any element on the current page' };
  }
  return { ok: true };
}
