import { useCallback, useEffect, useRef, useState } from 'react';
import type { DataSourceInstanceSettings } from '@grafana/data';

import { getNormalizedDatasourceType, type SupportedDatasourceType } from '../../constants/datasource-types';
import { runDataCheckQuery } from '../../lib/datasource/run-data-check-query';

export type DataCheckState = 'idle' | 'checking' | 'passed' | 'failed';

export interface UseDataCheckOptions {
  datasource: DataSourceInstanceSettings | null;
  query?: string;
  timeFrom?: string;
  timeTo?: string;
}

export interface UseDataCheckResult {
  state: DataCheckState;
  failureDetail: string;
  /** `null` when the picked data source has no query model a check can build. */
  supportedType: SupportedDatasourceType | null;
  canRun: boolean;
  run: () => Promise<boolean>;
  reset: () => void;
}

/**
 * Runs an author's query against the data source the user picked, on click only.
 * A `requirements` token would re-evaluate this on five separate timers.
 */
export function useDataCheck({ datasource, query, timeFrom, timeTo }: UseDataCheckOptions): UseDataCheckResult {
  const [state, setState] = useState<DataCheckState>('idle');
  const [failureDetail, setFailureDetail] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const supportedType = datasource ? getNormalizedDatasourceType(datasource.type) : null;
  const canRun = Boolean(datasource && supportedType && query?.trim());

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState('idle');
    setFailureDetail('');
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(async () => {
    if (!datasource || !supportedType || !query) {
      return false;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState('checking');
    setFailureDetail('');

    const result = await runDataCheckQuery({
      datasourceUid: datasource.uid,
      datasourceType: supportedType,
      query,
      from: timeFrom,
      to: timeTo,
      signal: controller.signal,
    });

    // A superseded or torn-down check must not write state over its replacement.
    if (controller.signal.aborted) {
      return false;
    }
    abortRef.current = null;

    if (result.ok && result.hasData) {
      setState('passed');
      return true;
    }
    setFailureDetail(result.ok ? '' : result.error);
    setState('failed');
    return false;
  }, [datasource, supportedType, query, timeFrom, timeTo]);

  return { state, failureDetail, supportedType, canRun, run, reset };
}
