/**
 * Guide identity — the id of the guide currently being rendered, used to
 * scope `var-*` requirement checks to that guide's stored responses.
 *
 * This module owns the canonical value as typed module-scope state.
 * `ContentRenderer` registers its derived guide id from a layout effect, so
 * the identity is published before any child's effect-driven requirement
 * check runs.
 *
 * Registration is a stack, not a single slot: several `ContentRenderer`s can
 * be mounted at once (docked panel, floating panel, guide overlay, block
 * preview). The most recent registration wins, and releasing it restores the
 * previous owner rather than leaving a dangling id behind.
 *
 * The `window.__DocsPluginGuideId` global is kept as a mirror of the top of
 * that stack and as a read fallback: the controller-mode live tab and the
 * non-guide `checkPostconditions` callers have no renderer-provided identity,
 * so a producer outside this module may be the only source. The fallback is
 * therefore load-bearing — do not remove it while those consumers exist.
 *
 * When nothing has registered an identity, the resolved value is the empty
 * string. There is deliberately no shared sentinel bucket: a common id is
 * exactly how one guide's answer would unlock a step in another.
 */

const GUIDE_ID_GLOBAL = '__DocsPluginGuideId';

interface GuideIdRegistration {
  readonly id: string;
}

let registrations: readonly GuideIdRegistration[] = [];

function mirrorToGlobal(): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    (window as unknown as Record<string, string>)[GUIDE_ID_GLOBAL] = topRegistration()?.id ?? '';
  } catch {
    // no-op
  }
}

function topRegistration(): GuideIdRegistration | undefined {
  return registrations[registrations.length - 1];
}

function readGlobal(): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  const value = (window as unknown as Record<string, unknown>)[GUIDE_ID_GLOBAL];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Publish `guideId` as the current guide identity and return a release
 * function that restores whichever identity was current before.
 */
export function registerGuideId(guideId: string): () => void {
  const registration: GuideIdRegistration = { id: guideId };
  registrations = [...registrations, registration];
  mirrorToGlobal();

  return () => {
    registrations = registrations.filter((entry) => entry !== registration);
    mirrorToGlobal();
  };
}

/**
 * Resolve the current guide identity, falling back to the
 * `window.__DocsPluginGuideId` global and then to the empty string.
 */
export function getCurrentGuideId(): string {
  return topRegistration()?.id || readGlobal() || '';
}

/**
 * Test-only reset. Drops every registration so each test starts from the
 * same baseline; the window global is not touched (callers manage that in
 * their own setup).
 */
export function resetGuideIdentityForTests(): void {
  registrations = [];
}
