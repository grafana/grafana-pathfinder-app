let policy: 'pending' | 'organization' | 'unrestricted' = 'unrestricted';
const listeners = new Set<() => void>();

export function suppressAutomaticLearningOffers(): boolean {
  return policy !== 'unrestricted';
}

export function setAutomaticLearningPolicy(next: typeof policy): void {
  policy = next;
  for (const listener of listeners) {
    listener();
  }
}

export function onAutomaticLearningPolicyChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
