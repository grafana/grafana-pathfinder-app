import type { SupportedDatasourceType } from '../../constants/datasource-types';

export const DATA_CHECK_REQUEST_EVENT = 'pathfinder-data-check-request';
export const DATA_CHECK_RESULT_EVENT = 'pathfinder-data-check-result';

export interface DataCheckRequestDetail {
  /** Correlates the result event back to the step that asked. */
  requestId: string;
  datasourceUid: string;
  datasourceType: SupportedDatasourceType;
  aiPrompt: string;
  timeFrom?: string;
  timeTo?: string;
}

export interface DataCheckResultDetail {
  requestId: string;
  passed: boolean;
  /** Shown to the user when the check fails. */
  reason: string;
}

export function dispatchDataCheckRequest(detail: DataCheckRequestDetail): void {
  window.dispatchEvent(new CustomEvent(DATA_CHECK_REQUEST_EVENT, { detail }));
}

export function dispatchDataCheckResult(detail: DataCheckResultDetail): void {
  window.dispatchEvent(new CustomEvent(DATA_CHECK_RESULT_EVENT, { detail }));
}
