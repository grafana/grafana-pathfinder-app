import { useCallback, useEffect, useState } from 'react';
import { getBackendSrv } from '@grafana/runtime';
import { PLUGIN_BACKEND_URL } from '../constants';
import { LearningInsightsResponseWireSchema, type LearningInsightsResponse } from '../types/learning-insights';

interface InsightsResult {
  key: string;
  data: LearningInsightsResponse | null;
  error: string | null;
}

export function useLearningInsights(from?: string, to?: string) {
  const [result, setResult] = useState<InsightsResult | null>(null);
  const [generation, setGeneration] = useState(0);
  const refresh = useCallback(() => setGeneration((value) => value + 1), []);
  const key = JSON.stringify([from, to, generation]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (from) {
      params.set('from', from);
    }
    if (to) {
      params.set('to', to);
    }
    const query = params.toString();
    getBackendSrv()
      .get<unknown>(`${PLUGIN_BACKEND_URL}/learning-insights${query ? `?${query}` : ''}`)
      .then((response) => {
        if (!cancelled) {
          setResult({ key, data: LearningInsightsResponseWireSchema.parse(response), error: null });
        }
      })
      .catch((failure: unknown) => {
        if (!cancelled) {
          const status = typeof failure === 'object' && failure !== null && 'status' in failure ? failure.status : null;
          const error =
            status === 403
              ? 'Learning insights is available to administrators of the current organization only.'
              : status === 404
                ? 'Learning insights is not supported by the installed plugin backend.'
                : 'Learning records could not be loaded. Try again.';
          setResult({ key, data: null, error });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, key]);

  const current = result?.key === key ? result : null;
  return { data: current?.data ?? null, loading: current === null, error: current?.error ?? null, refresh };
}
