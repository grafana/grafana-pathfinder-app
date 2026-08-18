/**
 * Compatibility guide identity for callers outside a ContentRenderer tree.
 *
 * Renderer-owned checks receive identity explicitly through their scoped
 * `GuideRequirementsProvider`. This stack remains only for external/controller
 * callers that genuinely cannot provide a guide id.
 *
 * When nothing has registered an identity, the resolved value is the empty
 * string. There is deliberately no shared sentinel bucket: a common id is
 * exactly how one guide's answer would unlock a step in another.
 *
 * Scoping is only as precise as the id itself. `ContentRenderer` derives it by
 * flattening the content URL's pathname, so distinct guides that flatten to the
 * same string still share a bucket. Tightening the derivation would orphan
 * already-stored responses, so it is deliberately left alone here — this module
 * separates identities, it does not guarantee they are unique.
 */

interface GuideIdRegistration {
  readonly id: string;
}

let registrations: readonly GuideIdRegistration[] = [];

function topRegistration(): GuideIdRegistration | undefined {
  return registrations[registrations.length - 1];
}

/**
 * Publish `guideId` for compatibility callers and return a release function
 * that restores whichever fallback identity was current before.
 */
export function registerCompatibilityGuideId(guideId: string): () => void {
  const registration: GuideIdRegistration = { id: guideId };
  registrations = [...registrations, registration];

  return () => {
    registrations = registrations.filter((entry) => entry !== registration);
  };
}

/**
 * Resolve the compatibility identity, falling back to the empty string.
 * Renderer-owned checks must supply identity directly.
 */
export function getCompatibilityGuideId(): string {
  return topRegistration()?.id || '';
}

/**
 * Test-only reset. Drops every registration so each test starts from the
 * same baseline.
 */
export function resetGuideIdentityForTests(): void {
  registrations = [];
}
