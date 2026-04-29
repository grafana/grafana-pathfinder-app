/**
 * Location-based checks: `on-page:` requirement.
 *
 * Returns canFix:true / fixType:'location' on failure so the location
 * fix-handler can navigate the user to the expected path.
 */

import { locationService } from '@grafana/runtime';
import type { CheckResultError } from '../requirements-checker.utils';

export async function onPageCheck(check: string): Promise<CheckResultError> {
  try {
    const location = locationService.getLocation();
    const requiredPath = check.replace('on-page:', '');
    const currentPath = location.pathname;
    const matches = currentPath.includes(requiredPath) || currentPath === requiredPath;

    return {
      requirement: check,
      pass: matches,
      error: matches ? undefined : `Current page '${currentPath}' does not match required path '${requiredPath}'`,
      canFix: !matches,
      fixType: matches ? undefined : 'location',
      targetHref: matches ? undefined : requiredPath,
    };
  } catch (error) {
    return {
      requirement: check,
      pass: false,
      error: `Page check failed: ${error}`,
    };
  }
}
