import { useCallback, useEffect, useRef } from 'react';

import {
  DATA_CHECK_REQUEST_EVENT,
  dispatchDataCheckResult,
  type DataCheckRequestDetail,
} from '../../integrations/assistant-integration/data-check-event';
import { useDataCheckGeneration } from '../../integrations/assistant-integration/useDataCheckGeneration.hook';

// Safety net: the assistant can resolve without a verdict or error, which would
// leave the step spinning forever.
const DATA_CHECK_REQUEST_TIMEOUT_MS = 30_000;

interface DataCheckOrchestratorProps {
  contentKey: string;
}

/**
 * Runs the assistant half of data checks off the step component.
 *
 * Mounted lazily so `@grafana/assistant` stays out of the docs-panel init chain
 * — its runtime init throws under jsdom. Hooks cannot be called conditionally,
 * so the SDK hook has to live in a component that only mounts when wanted.
 */
function DataCheckOrchestrator({ contentKey }: DataCheckOrchestratorProps): null {
  const { generate, verdict, error, reset, isAssistantAvailable } = useDataCheckGeneration(contentKey);

  const pendingRef = useRef<{ requestId: string; abort: AbortController } | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPending = useCallback(() => {
    // Dropping the controller without aborting leaves the assistant — and the
    // queries it is spending — running for a step that is already gone.
    pendingRef.current?.abort.abort();
    pendingRef.current = null;
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    reset();
  }, [reset]);

  // Runs on unmount and whenever the panel swaps guides; the step that asked for
  // the check is gone either way.
  useEffect(() => () => clearPending(), [clearPending, contentKey]);

  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent<DataCheckRequestDetail>).detail;
      if (!detail?.requestId) {
        return;
      }
      if (!isAssistantAvailable) {
        dispatchDataCheckResult({
          requestId: detail.requestId,
          passed: false,
          reason: 'The Grafana Assistant is not available in this instance.',
        });
        return;
      }
      if (pendingRef.current) {
        dispatchDataCheckResult({
          requestId: detail.requestId,
          passed: false,
          reason: 'Another data check is already running.',
        });
        return;
      }

      const abort = new AbortController();
      pendingRef.current = { requestId: detail.requestId, abort };
      timeoutRef.current = setTimeout(() => {
        const pending = pendingRef.current;
        if (!pending) {
          return;
        }
        dispatchDataCheckResult({
          requestId: pending.requestId,
          passed: false,
          reason: 'The check timed out.',
        });
        clearPending();
      }, DATA_CHECK_REQUEST_TIMEOUT_MS);

      await generate({
        datasourceUid: detail.datasourceUid,
        datasourceType: detail.datasourceType,
        aiPrompt: detail.aiPrompt,
        timeFrom: detail.timeFrom,
        timeTo: detail.timeTo,
        signal: abort.signal,
      });
    };

    window.addEventListener(DATA_CHECK_REQUEST_EVENT, handler);
    return () => window.removeEventListener(DATA_CHECK_REQUEST_EVENT, handler);
  }, [generate, isAssistantAvailable, clearPending]);

  useEffect(() => {
    if (!verdict) {
      return;
    }
    const pending = pendingRef.current;
    if (!pending) {
      clearPending();
      return;
    }
    dispatchDataCheckResult({
      requestId: pending.requestId,
      passed: verdict.verdict === 'pass',
      reason: verdict.reason,
    });
    clearPending();
  }, [verdict, clearPending]);

  useEffect(() => {
    if (!error) {
      return;
    }
    const pending = pendingRef.current;
    if (pending) {
      dispatchDataCheckResult({
        requestId: pending.requestId,
        passed: false,
        reason: error.message.slice(0, 200),
      });
    }
    clearPending();
  }, [error, clearPending]);

  return null;
}

// Lazy default export keeps @grafana/assistant out of the docs-panel init chain.
export default DataCheckOrchestrator;
