import type { AutoOpenGuideExperience } from './config';

export interface AutoOpenGuideEnrollment {
  variant: 'control' | 'treatment';
  experiences: readonly AutoOpenGuideExperience[];
}

let enrollment: AutoOpenGuideEnrollment | null = null;

// Cache read only, so analytics enrichment and the Featured slot can never enroll anyone.
export function getAutoOpenGuideEnrollment(): AutoOpenGuideEnrollment | null {
  return enrollment;
}

export function setAutoOpenGuideEnrollment(next: AutoOpenGuideEnrollment | null): void {
  enrollment = next;
}
