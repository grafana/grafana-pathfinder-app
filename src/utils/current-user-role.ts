/**
 * The one place Pathfinder reads who the current user is and what role they
 * hold. Role and Grafana-admin come from the namespace-scoped IAM API through
 * the plugin backend. Grafana Cloud never trusts the boot snapshot for them:
 * until the live answer arrives the role is unknown. Self-hosted Grafana has
 * no proxy credential, so boot data answers there.
 *
 * Grafana enforces access server-side; these predicates only decide what the
 * product steers someone at.
 */

import { useSyncExternalStore } from 'react';
import { config } from '@grafana/runtime';

import { fetchCoreUser, type CoreUser } from '../lib/grafana-core-client';
import { currentPlatform } from '../lib/platform';

export interface CurrentUser {
  available: boolean;
  id?: number;
  orgId?: number;
  isSignedIn: boolean;
  role?: string;
  isGrafanaAdmin: boolean;
}

const RETRY_AFTER_MS = 30_000;

let liveUser: CoreUser | undefined;
let inflight: Promise<CoreUser | undefined> | undefined;
let lastAttemptAt = 0;
const listeners = new Set<() => void>();

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function bootRoleTrusted(): boolean {
  return currentPlatform() !== 'cloud';
}

export function currentUser(): CurrentUser {
  const user = config?.bootData?.user;
  const trustBoot = bootRoleTrusted();
  return {
    available: Boolean(user || liveUser),
    id: positiveInteger(user?.id),
    orgId: positiveInteger(user?.orgId),
    isSignedIn: user?.isSignedIn === true,
    role: liveUser?.role ?? (trustBoot ? user?.orgRole || undefined : undefined),
    isGrafanaAdmin: liveUser ? liveUser.grafanaAdmin === true : trustBoot && user?.isGrafanaAdmin === true,
  };
}

export function isCurrentUserRoleKnown(): boolean {
  return Boolean(liveUser) || bootRoleTrusted();
}

/** Resolves the live role, or `undefined` when the proxy cannot answer. */
export async function refreshCurrentUser(): Promise<CoreUser | undefined> {
  lastAttemptAt = Date.now();
  inflight ??= fetchCoreUser()
    .then((fetched) => {
      if (fetched) {
        liveUser = fetched;
        listeners.forEach((listener) => listener());
      }
      return fetched;
    })
    .finally(() => {
      inflight = undefined;
    });
  return inflight;
}

/** Waits for the live role while it is unknown, retrying a failed read at most every 30 s. */
export async function ensureCurrentUser(): Promise<void> {
  if (isCurrentUserRoleKnown()) {
    return;
  }
  if (inflight) {
    await inflight;
    return;
  }
  if (Date.now() - lastAttemptAt >= RETRY_AFTER_MS) {
    await refreshCurrentUser();
  }
}

export function subscribeToCurrentUser(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetCurrentUserForTests(): void {
  liveUser = undefined;
  inflight = undefined;
  lastAttemptAt = 0;
  listeners.clear();
}

export function currentUserIsAdmin(): boolean {
  const user = currentUser();
  return user.isGrafanaAdmin || user.role === 'Admin';
}

export function currentUserIsEditor(): boolean {
  const user = currentUser();
  return user.isGrafanaAdmin || user.role === 'Admin' || user.role === 'Editor';
}

export function useCurrentUserIsAdmin(): boolean {
  return useSyncExternalStore(subscribeToCurrentUser, currentUserIsAdmin);
}

export function useCurrentUserIsEditor(): boolean {
  return useSyncExternalStore(subscribeToCurrentUser, currentUserIsEditor);
}
