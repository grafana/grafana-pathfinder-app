import { AUTO_OPEN_GUIDE_MAX_EXPERIENCES } from '../../../constants/auto-open-guide-experiment';
import { findDocPage } from '../../find-doc-page';
import { matchPathPattern, parseExperimentVariant, type ExperimentConfig } from '../../openfeature';

export interface AutoOpenGuideExperience {
  guide: string;
  pages: string[];
}

export interface AutoOpenGuideConfig {
  variant: ExperimentConfig['variant'];
  experiences: AutoOpenGuideExperience[];
}

function isExperience(value: unknown): value is AutoOpenGuideExperience {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const { guide, pages } = value as Record<string, unknown>;
  return (
    typeof guide === 'string' &&
    findDocPage(guide) !== null &&
    Array.isArray(pages) &&
    pages.length > 0 &&
    pages.every((page) => typeof page === 'string' && page.trim() !== '')
  );
}

export function isAutoOpenGuideConfig(value: unknown): value is AutoOpenGuideConfig {
  const variant = parseExperimentVariant(value);
  if (!variant) {
    return false;
  }
  if (variant === 'excluded') {
    return true;
  }
  const { experiences } = value as Record<string, unknown>;
  return (
    Array.isArray(experiences) &&
    experiences.length > 0 &&
    experiences.length <= AUTO_OPEN_GUIDE_MAX_EXPERIENCES &&
    experiences.every(isExperience)
  );
}

export function matchesExperience(experience: AutoOpenGuideExperience, path: string): boolean {
  return experience.pages.some((pattern) => matchPathPattern(pattern, path));
}
