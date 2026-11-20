import { SOURCE_HASH_CODES } from '../codes';
import type { SidecarCheck } from '../types';

/** Errors on a translated entry with no `_sourceHash`; warns on one that no longer matches the English text. */
export const sourceHashCheck: SidecarCheck = {
  id: 'source-hash',
  pendingIssue: '#2388',
  codes: SOURCE_HASH_CODES,
  run: () => [],
};
