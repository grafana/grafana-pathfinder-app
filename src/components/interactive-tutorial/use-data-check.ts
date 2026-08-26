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

/**
 * `'aborted'` is not an outcome to report — the check was superseded or given
 * up on. `'timeout'` and `'error'` both render as "could not run", but a run we
 * gave up waiting for and one the backend refused are different operational
 * problems, so they stay separate in telemetry.
 */
export type DataCheckOutcome = 'passed' | 'no-data' | 'error' | 'timeout' | 'aborted';

export interface DataCheckReport {
  outcome: DataCheckOutcome;
  durationMs: number;
}

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
  run: () => Promise<DataCheckReport>;
  reset: () => void;
}

/** A verdict is only ever about the data source it was run against. */
interface Verdict {
  datasourceUid: string | null;
  state: DataCheckState;
  failureDetail: string;
}

const IDLE: Verdict = { datasourceUid: null, state: 'idle', failureDetail: '' };

/**
 * Runs an author's query against the data source the user picked, on click only.
 * A `requirements` token would re-evaluate this on five separate timers.
 */
export function useDataCheck({ datasource, query, timeFrom, timeTo }: UseDataCheckOptions): UseDataCheckResult {
  const [verdict, setVerdict] = useState<Verdict>(IDLE);
  const abortRef = useRef<AbortController | null>(null);

  const supportedType = datasource ? getNormalizedDatasourceType(datasource.type) : null;
  const canRun = Boolean(datasource && supportedType && query?.trim());

  // The pick can change from anywhere — a sibling picker, a variable write, a
  // guide reset — not just from the host this hook is in. Deriving the verdict
  // against the current uid means none of those paths can leave a stale one on
  // screen, rather than each of them having to remember to clear it.
  const datasourceUid = datasource?.uid ?? null;
  const isCurrent = verdict.datasourceUid === datasourceUid;
  const state = isCurrent ? verdict.state : 'idle';
  const failureDetail = isCurrent ? verdict.failureDetail : '';

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setVerdict(IDLE);
  }, []);

  // Cleanup fires on unmount and whenever the pick changes, so a check whose
  // data source moved under it stops spending.
  useEffect(() => () => abortRef.current?.abort(), [datasourceUid]);

  const run = useCallback(async (): Promise<DataCheckReport> => {
    if (!datasource || !supportedType || !query) {
      return { outcome: 'aborted', durationMs: 0 };
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setVerdict({ datasourceUid: datasource.uid, state: 'checking', failureDetail: '' });

    const startedAt = performance.now();
    const result = await runDataCheckQuery({
      datasourceUid: datasource.uid,
      datasourceType: supportedType,
      query,
      from: timeFrom,
      to: timeTo,
      signal: controller.signal,
    });
    const durationMs = Math.round(performance.now() - startedAt);

    // A superseded or torn-down check must not write state over its replacement.
    if (controller.signal.aborted) {
      return { outcome: 'aborted', durationMs };
    }
    abortRef.current = null;

    if (!result.ok) {
      setVerdict({ datasourceUid: datasource.uid, state: 'error', failureDetail: result.error });
      return { outcome: result.failureKind === 'timeout' ? 'timeout' : 'error', durationMs };
    }
    if (result.hasData) {
      setVerdict({ datasourceUid: datasource.uid, state: 'passed', failureDetail: '' });
      return { outcome: 'passed', durationMs };
    }
    setVerdict({ datasourceUid: datasource.uid, state: 'no-data', failureDetail: '' });
    return { outcome: 'no-data', durationMs };
  }, [datasource, supportedType, query, timeFrom, timeTo]);

  return { state, failureDetail, supportedType, canRun, run, reset };
}
