import { useEffect, useRef } from 'react';

import { panelModeManager } from '../../../global-state/panel-mode';
import { isModalCoexistenceSupported } from '../../../lib/grafana-version';

export interface UseCompanionModeArgs {
  companion: boolean | undefined;
  isActive: boolean;
  isCompleted: boolean;
  isPreviewMode: boolean;
}

/**
 * While an authored `companion` section is the live (expanded, incomplete) one,
 * pop the panel out to floating so the user can operate a native Grafana modal
 * alongside the guide, and dock back when the section finishes. Gated on
 * isModalCoexistenceSupported() — dormant on Grafana without the modal fix.
 */
export function useCompanionMode({ companion, isActive, isCompleted, isPreviewMode }: UseCompanionModeArgs): void {
  const weOwnFloatingRef = useRef(false);

  useEffect(() => {
    if (!companion || isPreviewMode || !isActive || isCompleted || !isModalCoexistenceSupported()) {
      return;
    }

    // Only dock back what we popped out: if the user was already floating, leave them be.
    if (panelModeManager.getMode() === 'sidebar') {
      weOwnFloatingRef.current = true;
      document.dispatchEvent(new CustomEvent('pathfinder-request-pop-out'));
    }
    return () => {
      if (weOwnFloatingRef.current) {
        weOwnFloatingRef.current = false;
        document.dispatchEvent(new CustomEvent('pathfinder-request-dock'));
      }
    };
  }, [companion, isActive, isCompleted, isPreviewMode]);
}
