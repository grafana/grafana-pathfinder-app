import type { Recommendation } from '../../../types/context.types';
import { findDocPage } from '../../find-doc-page';
import { matchesExperience } from './config';
import { getAutoOpenGuideEnrollment } from './state';

export function getAutoOpenGuideFeatured(currentPath: string): Recommendation | null {
  const enrollment = getAutoOpenGuideEnrollment();
  if (enrollment?.variant !== 'treatment') {
    return null;
  }
  const experience = enrollment.experiences.find((candidate) => matchesExperience(candidate, currentPath));
  const docPage = experience ? findDocPage(experience.guide) : null;
  if (!docPage) {
    return null;
  }
  return {
    title: docPage.title,
    url: docPage.url,
    type: docPage.type,
    matchAccuracy: 1,
    summary: '',
  };
}
