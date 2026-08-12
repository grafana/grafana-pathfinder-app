import React, { createContext, type PropsWithChildren, useContext, useMemo } from 'react';

import {
  checkPostconditions as checkPostconditionsWithOptions,
  checkRequirements as checkRequirementsWithOptions,
  type RequirementsCheckOptions,
  type RequirementsCheckResult,
} from './requirements-checker.utils';

export type GuideRequirementsCheckOptions = Omit<RequirementsCheckOptions, 'guideId'>;

interface GuideRequirementsContextValue {
  checkRequirements: (options: GuideRequirementsCheckOptions) => Promise<RequirementsCheckResult>;
  checkPostconditions: (options: GuideRequirementsCheckOptions) => Promise<RequirementsCheckResult>;
}

const compatibilityFallback: GuideRequirementsContextValue = {
  checkRequirements: checkRequirementsWithOptions,
  checkPostconditions: checkPostconditionsWithOptions,
};

const GuideRequirementsContext = createContext<GuideRequirementsContextValue>(compatibilityFallback);

export function GuideRequirementsProvider({ guideId, children }: PropsWithChildren<{ guideId: string }>) {
  const value = useMemo<GuideRequirementsContextValue>(
    () => ({
      checkRequirements: (options) => checkRequirementsWithOptions({ ...options, guideId }),
      checkPostconditions: (options) => checkPostconditionsWithOptions({ ...options, guideId }),
    }),
    [guideId]
  );

  return <GuideRequirementsContext.Provider value={value}>{children}</GuideRequirementsContext.Provider>;
}

export function useGuideRequirements(): GuideRequirementsContextValue {
  return useContext(GuideRequirementsContext);
}
