import { config } from '@grafana/runtime';
import { validateRedirectPath } from '../../security/url-validator';

/**
 * `targetPath` (see `FullScreenPanel.tsx`'s `handleExitToSidebar`) is
 * author-controlled manifest data, reaching `locationService.push` with no
 * user confirmation — validate it the same way `NavigateHandler` validates
 * its own author-controlled navigation target before ever pushing it.
 */
export function resolveSafeTargetPath(candidate: string): string | undefined {
  // Reject protocol-relative URLs before validateRedirectPath, which would
  // otherwise resolve '//evil.com' to a same-origin '/' and let it through
  // (mirrors NavigateHandler's own pre-check for the same reason).
  if (!candidate.startsWith('/') || candidate.startsWith('//')) {
    return undefined;
  }
  const user = config.bootData?.user;
  const isAdmin = user?.isGrafanaAdmin === true || user?.orgRole === 'Admin';
  const safePath = validateRedirectPath(candidate, isAdmin);
  // validateRedirectPath falls back to '/' for both "already root" and
  // "rejected" inputs. This feature already treats '/' as no real signal
  // (see full-screen-fallback-location.ts), so collapse both cases the same
  // way rather than forcing a navigate to the plugin root on rejection.
  return safePath !== '/' ? safePath : undefined;
}
