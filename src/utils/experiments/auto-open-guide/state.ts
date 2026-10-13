import type { AutoOpenGuideExperience } from './config';

export interface AutoOpenGuideEnrollment {
  variant: 'control' | 'treatment';
  experiences: readonly AutoOpenGuideExperience[];
  offeredGuide?: string;
}

let enrollment: AutoOpenGuideEnrollment | null = null;
const listeners = new Set<() => void>();

// Cache read only, so analytics enrichment and the Featured slot can never enroll anyone.
export function getAutoOpenGuideEnrollment(): AutoOpenGuideEnrollment | null {
  return enrollment;
}

export function setAutoOpenGuideEnrollment(next: AutoOpenGuideEnrollment | null): void {
  enrollment = next;
  for (const listener of [...listeners]) {
    listener();
  }
}

// Recommendations can finish fetching before activation resolves; this lets them refetch.
export function subscribeToAutoOpenGuideEnrollment(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
