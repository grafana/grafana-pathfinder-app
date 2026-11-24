import { LANGUAGE_TAG_CODES } from '../codes';
import type { SidecarCheck } from '../types';

/** Checks the sidecar file name and `language` tags, and rejects hidden Unicode in translated text. */
export const languageTagCheck: SidecarCheck = {
  id: 'language-tag',
  pendingIssue: '#2392',
  codes: LANGUAGE_TAG_CODES,
  run: () => [],
};
