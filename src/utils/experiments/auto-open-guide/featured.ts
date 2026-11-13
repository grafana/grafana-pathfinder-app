import type { Recommendation } from '../../../types/context.types';
import { findDocPage } from '../../find-doc-page';
import { matchesExperience } from './config';
import { getAutoOpenGuideEnrollment } from './state';

export function getAutoOpenGuideFeatured(currentPath: string): Recommendation | null {
  const enrollment = getAutoOpenGuideEnrollment();
  if (enrollment?.variant !== 'treatment') {
    return null;
  }
  const matching = enrollment.experiences.filter((candidate) => matchesExperience(candidate, currentPath));
  const experience = matching.find((candidate) => candidate.guide === enrollment.offeredGuide) ?? matching[0];
  const docPage = experience ? findDocPage(experience.guide) : null;
  if (!docPage) {
    return null;
  }
  return {
    placement: 'experiment',
    title: docPage.title,
    url: docPage.url,
    type: docPage.type,
    matchAccuracy: 1,
    summary: '',
  };
}
