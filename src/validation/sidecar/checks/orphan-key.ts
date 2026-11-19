import { ORPHAN_KEY_CODES } from '../codes';
import type { SidecarCheck } from '../types';

/** Warns on a sidecar block or step key that matches no id in `content.json`. */
export const orphanKeyCheck: SidecarCheck = {
  id: 'orphan-key',
  pendingIssue: '#2387',
  codes: ORPHAN_KEY_CODES,
  run: () => [],
};
