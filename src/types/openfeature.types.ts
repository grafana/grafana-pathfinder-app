export const EXPERIMENT_VARIANTS = ['excluded', 'control', 'treatment'] as const;

export type ExperimentVariant = (typeof EXPERIMENT_VARIANTS)[number];

/** Experiment configuration returned by GOFF. */
export interface ExperimentConfig {
  variant: ExperimentVariant;
  pages: string[];
  resetCache?: boolean;
}

export type HighlightedGuideDocType = 'docs-page' | 'learning-journey' | 'interactive';

/**
 * Highlighted-guide experiment configuration used for sidebar auto-open and
 * Featured-slot injection.
 */
export interface HighlightedGuideConfig extends ExperimentConfig {
  guideId: string;
  autoOpen: boolean;
  docType?: HighlightedGuideDocType;
}
