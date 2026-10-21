import { useCallback, useEffect, useState } from 'react';
import { getBackendSrv } from '@grafana/runtime';
import { PLUGIN_BACKEND_URL } from '../constants';
import { LearningInsightsResponseWireSchema } from '../types/backend-api.schema';
import type { LearningInsightsResponse } from '../types/learning-insights';

export function useLearningInsights(from?: string, to?: string) {
  const [data, setData] = useState<LearningInsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const refresh = useCallback(() => setGeneration((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
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
          setData(LearningInsightsResponseWireSchema.parse(response));
        }
      })
      .catch((failure: unknown) => {
        if (!cancelled) {
          const status = typeof failure === 'object' && failure !== null && 'status' in failure ? failure.status : null;
          setError(
            status === 403
              ? 'Learning insights is available to administrators of the current organization only.'
              : status === 404
                ? 'Learning insights is not supported by the installed plugin backend.'
                : 'Learning records could not be loaded. Try again.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, generation]);

  return { data, loading, error, refresh };
}
