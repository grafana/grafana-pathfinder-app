/**
 * `/` and empty/missing both mean "no real signal" for the full-screen ->
 * sidebar handoff (see interactive-engine/interactive.hook.ts) — even though
 * the existing alignment system (resolveStartingLocation) treats `/` as a
 * real, confirmation-gated target for its own unrelated purpose. This handoff
 * has no confirmation step, so a bare schema default must not silently
 * relocate the user.
 */
export function resolveFullScreenFallbackLocation(candidate: string | undefined): string | undefined {
  const trimmed = candidate?.trim();
  return trimmed && trimmed !== '/' ? trimmed : undefined;
}
