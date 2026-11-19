import { TEXT_DEPENDENT_SELECTOR_CODES } from '../codes';
import type { SidecarCheck } from '../types';

/** Errors on a `content.json` target that only matches English UI text, in a package that ships a sidecar. */
export const textDependentSelectorCheck: SidecarCheck = {
  id: 'text-dependent-selector',
  pendingIssue: '#2390',
  codes: TEXT_DEPENDENT_SELECTOR_CODES,
  run: () => [],
};
