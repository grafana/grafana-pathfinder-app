import { resolveSelectorForVersion } from '../../../src/lib/dom/selector-resolver-core';

export function resolveSelector(reftarget: string): string {
  return resolveSelectorForVersion(reftarget, 'latest');
}
