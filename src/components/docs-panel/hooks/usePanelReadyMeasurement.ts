import * as React from 'react';
import { RECOMMENDATIONS_READY_EVENT } from '../../../lib/event-names';
import { recordPanelReady } from '../../../lib/telemetry';

// Panel-scoped analog of LCP, fired once per mount. Not Faro's page-level
// Web Vitals — those would measure Grafana core's render, not Pathfinder's.
export function usePanelReadyMeasurement(params: {
  hasContent: boolean;
  isRecommendationsTab: boolean;
  surface: string;
}): void {
  // Clock starts in the render pass, not the effect — effects run after
  // commit, which would measure already-ready content as ~0.
  const [renderStart] = React.useState(() => performance.now());
  const recordedRef = React.useRef(false);
  const [recommendationsReady, setRecommendationsReady] = React.useState(false);

  React.useEffect(() => {
    const onReady = () => setRecommendationsReady(true);
    document.addEventListener(RECOMMENDATIONS_READY_EVENT, onReady);
    return () => document.removeEventListener(RECOMMENDATIONS_READY_EVENT, onReady);
  }, []);

  const { hasContent, isRecommendationsTab, surface } = params;
  React.useEffect(() => {
    if (recordedRef.current) {
      return;
    }
    if (hasContent || (isRecommendationsTab && recommendationsReady)) {
      recordedRef.current = true;
      recordPanelReady(performance.now() - renderStart, surface);
    }
  }, [hasContent, isRecommendationsTab, recommendationsReady, surface, renderStart]);
}
