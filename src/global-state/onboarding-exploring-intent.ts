import { config } from '@grafana/runtime';

export interface OnboardingExploringIntentSnapshot {
  status: 'loading' | 'ready' | 'unavailable';
  exploring: boolean;
  contextKey: string;
}

export const getOnboardingIntentContextKey = (): string =>
  JSON.stringify([
    config.namespace ?? '',
    config.bootData.user.id,
    config.bootData.user.orgId,
    config.bootData.user.uid ?? '',
    config.bootData.user.isSignedIn,
  ]);

let snapshot: OnboardingExploringIntentSnapshot | null = null;
const listeners = new Set<() => void>();

export function hasSavedExploringIntent(): boolean {
  return snapshot?.status === 'ready' && snapshot.exploring && snapshot.contextKey === getOnboardingIntentContextKey();
}

export function hasSavedNonExploringIntent(): boolean {
  return snapshot?.status === 'ready' && !snapshot.exploring && snapshot.contextKey === getOnboardingIntentContextKey();
}

export function setOnboardingExploringIntent(value: unknown): void {
  const next = value as Partial<OnboardingExploringIntentSnapshot> | null;
  const previous = snapshot;
  snapshot =
    next &&
    (next.status === 'loading' || next.status === 'ready' || next.status === 'unavailable') &&
    typeof next.exploring === 'boolean' &&
    typeof next.contextKey === 'string'
      ? { status: next.status, exploring: next.exploring, contextKey: next.contextKey }
      : null;
  if (
    previous === snapshot ||
    (previous &&
      snapshot &&
      previous.status === snapshot.status &&
      previous.exploring === snapshot.exploring &&
      previous.contextKey === snapshot.contextKey)
  ) {
    return;
  }
  for (const listener of [...listeners]) {
    listener();
  }
}

export function subscribeToOnboardingExploringIntent(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
