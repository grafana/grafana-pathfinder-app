import * as React from 'react';

import { getActiveTabUrl } from '../../../global-state/content-key';
import type { PathfinderE2EControlV1 } from '../../../types/window-globals';
import { resetGuideProgress } from './resetGuideProgress';

export const E2E_GUIDE_URL = 'bundled:e2e-test';
// Bump only when the control shape or reset completion guarantees become incompatible with existing runners.
export const PATHFINDER_E2E_CONTROL_VERSION = 1;

interface UseE2EResetGuideCapabilityParams {
  activeTabCurrentUrl?: string;
  activeTabBaseUrl?: string;
}

export function useE2EResetGuideCapability({
  activeTabCurrentUrl,
  activeTabBaseUrl,
}: UseE2EResetGuideCapabilityParams): void {
  const activeTabUrl = activeTabCurrentUrl || activeTabBaseUrl;

  React.useLayoutEffect(() => {
    if (activeTabUrl !== E2E_GUIDE_URL) {
      delete window.__pathfinderE2E;
      return;
    }

    const control: PathfinderE2EControlV1 = {
      version: PATHFINDER_E2E_CONTROL_VERSION,
      async resetActiveGuide(): Promise<void> {
        if (window.__pathfinderE2E !== control || getActiveTabUrl() !== E2E_GUIDE_URL) {
          throw new Error('The E2E guide is no longer active');
        }
        await resetGuideProgress(E2E_GUIDE_URL);
      },
    };

    window.__pathfinderE2E = control;

    return () => {
      if (window.__pathfinderE2E === control) {
        delete window.__pathfinderE2E;
      }
    };
  }, [activeTabUrl]);
}
