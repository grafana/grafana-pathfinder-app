/**
 * Maps a rendered guide's content key to its durable completion identity.
 *
 * A `pathfinder:progress` event names a content key — a URL or path — not a
 * guide identity, and only the surface rendering the guide holds the manifest
 * that resolves one. Surfaces register here while they render; the progress
 * observer reads it back. A key no surface has registered has no identity, and
 * progress for it is ignored rather than keyed on a loader URL.
 */

import type { CompletionCategory } from './types';

export interface RegisteredGuideIdentity {
  guideSource: string;
  guideId: string;
  guideTitle: string;
  guideCategory: CompletionCategory;
  pathId?: string;
}

interface Registration {
  token: symbol;
  identity: RegisteredGuideIdentity;
}

const registrations = new Map<string, Registration[]>();

/** The latest mounted surface wins; its cleanup restores any remaining owner. */
export function registerGuideIdentity(contentKey: string, identity: RegisteredGuideIdentity): () => void {
  const token = Symbol(contentKey);
  registrations.set(contentKey, [...(registrations.get(contentKey) ?? []), { token, identity: { ...identity } }]);
  return () => {
    const remaining = registrations.get(contentKey)?.filter((registration) => registration.token !== token);
    if (remaining?.length) {
      registrations.set(contentKey, remaining);
    } else {
      registrations.delete(contentKey);
    }
  };
}

export function lookupGuideIdentity(contentKey: string): RegisteredGuideIdentity | null {
  return registrations.get(contentKey)?.at(-1)?.identity ?? null;
}

export function __resetGuideIdentityRegistryForTests(): void {
  registrations.clear();
}
