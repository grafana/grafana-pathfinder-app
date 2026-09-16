import { validateInternalNavigationPath } from '../../security/url-validator';
import { currentUserIsAdmin } from '../../utils/current-user-role';

/**
 * `targetPath` (see `FullScreenPanel.tsx`'s `handleExitToSidebar`) is
 * author-controlled manifest or requirement data, reaching
 * `locationService.push` with no user confirmation — validate it the same way
 * every other internal navigation target is validated before pushing it.
 */
export function resolveSafeTargetPath(candidate: string): string | undefined {
  const safePath = validateInternalNavigationPath(candidate, currentUserIsAdmin());
  if (!safePath) {
    return undefined;
  }

  // This feature treats root as no real signal (see
  // full-screen-fallback-location.ts), including root with search or hash.
  return new URL(safePath, window.location.origin).pathname !== '/' ? safePath : undefined;
}

/**
 * `REQUEST_SIDEBAR_HANDOFF_EVENT`'s `detail` is whatever a dispatcher put
 * there — a TypeScript cast at the listener doesn't guarantee it's actually
 * shaped right at runtime. Any script sharing the page can dispatch this
 * custom event, so a malformed `targetPath` (e.g. a number) must be treated
 * as "no path provided" rather than reaching `resolveSafeTargetPath`, which
 * assumes a string and would throw on `.startsWith`.
 */
export function extractTargetPathFromEventDetail(detail: unknown): string | undefined {
  if (!detail || typeof detail !== 'object') {
    return undefined;
  }
  const targetPath = (detail as Record<string, unknown>).targetPath;
  return typeof targetPath === 'string' ? targetPath : undefined;
}
