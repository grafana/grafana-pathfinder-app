import { config } from '@grafana/runtime';

export interface OnboardingExploringIntentSnapshot {
  status: 'loading' | 'ready' | 'unavailable';
  exploring: boolean;
  contextKey: string;
}

export const getOnboardingIntentContextKey = (): string =>
  JSON.stringify([config.namespace ?? '', config.bootData.user.id, config.bootData.user.orgId]);

let snapshot: OnboardingExploringIntentSnapshot | null = null;
const listeners = new Set<() => void>();

export function hasSavedExploringIntent(): boolean {
  return snapshot?.status === 'ready' && snapshot.exploring && snapshot.contextKey === getOnboardingIntentContextKey();
}

export function setOnboardingExploringIntent(value: unknown): void {
  const next = value as Partial<OnboardingExploringIntentSnapshot> | null;
  snapshot =
    next &&
    (next.status === 'loading' || next.status === 'ready' || next.status === 'unavailable') &&
    typeof next.exploring === 'boolean' &&
    typeof next.contextKey === 'string'
      ? (next as OnboardingExploringIntentSnapshot)
      : null;
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
