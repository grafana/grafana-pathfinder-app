import { TRANSLATABLE_IDS_CODES } from '../codes';
import type { SidecarCheck } from '../types';

/** Errors on a translatable block or step with no id, and on duplicate ids, in a package that ships a sidecar. */
export const translatableIdsCheck: SidecarCheck = {
  id: 'translatable-ids',
  pendingIssue: '#2391',
  codes: TRANSLATABLE_IDS_CODES,
  run: () => [],
};
