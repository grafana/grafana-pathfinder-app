import { useCallback, useEffect, useRef, useState } from 'react';
import type { DataSourceInstanceSettings } from '@grafana/data';

import { getNormalizedDatasourceType, type SupportedDatasourceType } from '../../constants/datasource-types';
import { runDataCheckQuery } from '../../lib/datasource/run-data-check-query';

/**
 * `'no-data'` and `'error'` are deliberately separate: the query returning
 * nothing is a fact about the user's data, while a timeout or an HTTP failure
 * means the check never ran. Telling the user the metric is missing when we
 * simply could not look is a lie they may act on.
 */
export type DataCheckState = 'idle' | 'checking' | 'passed' | 'no-data' | 'error';

/** `'aborted'` is not an outcome to report — the check was superseded or given up on. */
export type DataCheckOutcome = 'passed' | 'no-data' | 'error' | 'aborted';

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
  run: () => Promise<DataCheckOutcome>;
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

  const run = useCallback(async (): Promise<DataCheckOutcome> => {
    if (!datasource || !supportedType || !query) {
      return 'aborted';
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
      return 'aborted';
    }
    abortRef.current = null;

    if (!result.ok) {
      setFailureDetail(result.error);
      setState('error');
      return 'error';
    }
    if (result.hasData) {
      setState('passed');
      return 'passed';
    }
    setFailureDetail('');
    setState('no-data');
    return 'no-data';
  }, [datasource, supportedType, query, timeFrom, timeTo]);

  return { state, failureDetail, supportedType, canRun, run, reset };
}
