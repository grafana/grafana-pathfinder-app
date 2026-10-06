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

const registrations = new Map<string, Registration>();

/**
 * Register `identity` for `contentKey`, replacing any earlier registration.
 * The returned function removes the registration only while it is still this
 * one, so a surface unmounting after another took over leaves the newer one in place.
 */
export function registerGuideIdentity(contentKey: string, identity: RegisteredGuideIdentity): () => void {
  const token = Symbol(contentKey);
  registrations.set(contentKey, { token, identity: { ...identity } });
  return () => {
    if (registrations.get(contentKey)?.token === token) {
      registrations.delete(contentKey);
    }
  };
}

export function lookupGuideIdentity(contentKey: string): RegisteredGuideIdentity | null {
  return registrations.get(contentKey)?.identity ?? null;
}

export function __resetGuideIdentityRegistryForTests(): void {
  registrations.clear();
}
