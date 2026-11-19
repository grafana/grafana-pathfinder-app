import { PROJECTION_CONFORMANCE_CODES } from '../codes';
import type { SidecarCheck } from '../types';

/** Errors on a sidecar field the projection table does not allow for the addressed block type. */
export const projectionConformanceCheck: SidecarCheck = {
  id: 'projection-conformance',
  pendingIssue: '#2389',
  codes: PROJECTION_CONFORMANCE_CODES,
  run: () => [],
};
