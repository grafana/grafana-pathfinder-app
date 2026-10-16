export const EXPERIMENT_VARIANTS = ['excluded', 'control', 'treatment'] as const;

export type ExperimentVariant = (typeof EXPERIMENT_VARIANTS)[number];

/** Experiment configuration returned by GOFF. */
export interface ExperimentConfig {
  variant: ExperimentVariant;
  pages: string[];
  resetCache?: boolean;
}
