import React, { createContext, type PropsWithChildren, useContext, useMemo } from 'react';
import { sanitizeContentKey } from '../global-state/content-key';

import {
  checkPostconditions as checkPostconditionsWithOptions,
  checkRequirements as checkRequirementsWithOptions,
  type RequirementsCheckOptions,
  type RequirementsCheckResult,
} from './requirements-checker.utils';

export type GuideRequirementsCheckOptions = Omit<RequirementsCheckOptions, 'guideId' | 'contentKey'>;

interface GuideRequirementsContextValue {
  guideId?: string;
  contentKey?: string;
  checkRequirements: (options: GuideRequirementsCheckOptions) => Promise<RequirementsCheckResult>;
  checkPostconditions: (options: GuideRequirementsCheckOptions) => Promise<RequirementsCheckResult>;
}

const compatibilityFallback: GuideRequirementsContextValue = {
  checkRequirements: checkRequirementsWithOptions,
  checkPostconditions: checkPostconditionsWithOptions,
};

const GuideRequirementsContext = createContext<GuideRequirementsContextValue>(compatibilityFallback);

export function GuideRequirementsProvider({
  guideId,
  contentKey,
  children,
}: PropsWithChildren<{ guideId: string; contentKey?: string }>) {
  const scopedContentKey = contentKey === undefined ? undefined : sanitizeContentKey(contentKey);
  const value = useMemo<GuideRequirementsContextValue>(
    () => ({
      guideId,
      contentKey: scopedContentKey,
      checkRequirements: (options) =>
        checkRequirementsWithOptions({ ...options, guideId, contentKey: scopedContentKey }),
      checkPostconditions: (options) =>
        checkPostconditionsWithOptions({ ...options, guideId, contentKey: scopedContentKey }),
    }),
    [guideId, scopedContentKey]
  );

  return <GuideRequirementsContext.Provider value={value}>{children}</GuideRequirementsContext.Provider>;
}

export function useGuideRequirements(): GuideRequirementsContextValue {
  return useContext(GuideRequirementsContext);
}
