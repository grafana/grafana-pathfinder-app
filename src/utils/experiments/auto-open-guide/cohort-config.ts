import { isAutoOpenGuideConfig, type AutoOpenGuideConfig, type AutoOpenGuideExperience } from './config';

export interface CohortAutoOpenExperience extends AutoOpenGuideExperience {
  cohort: string;
}

export interface CohortAutoOpenConfig extends AutoOpenGuideConfig {
  experiences: CohortAutoOpenExperience[];
}

export function isCohortAutoOpenConfig(value: unknown): value is CohortAutoOpenConfig {
  if (!isAutoOpenGuideConfig(value)) {
    return false;
  }
  return (
    value.variant === 'excluded' ||
    value.experiences.every((experience) => {
      const cohort = (experience as Partial<CohortAutoOpenExperience>).cohort;
      return typeof cohort === 'string' && cohort.trim().length > 0;
    })
  );
}
