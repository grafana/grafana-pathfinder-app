import { resolveSafeTargetPath, extractTargetPathFromEventDetail } from './resolve-safe-target-path';

describe('resolveSafeTargetPath', () => {
  it('passes through a safe same-origin path', () => {
    expect(resolveSafeTargetPath('/connections/datasources')).toBe('/connections/datasources');
  });

  it('rejects a protocol-relative URL before it ever reaches validateRedirectPath', () => {
    expect(resolveSafeTargetPath('//evil.com')).toBeUndefined();
  });

  it('rejects an absolute external URL', () => {
    expect(resolveSafeTargetPath('https://evil.com')).toBeUndefined();
  });

  it('rejects a path not starting with a slash', () => {
    expect(resolveSafeTargetPath('relative/path')).toBeUndefined();
  });

  it('treats a denied route (e.g. /logout) as no real signal, not a navigate-to-root', () => {
    expect(resolveSafeTargetPath('/logout')).toBeUndefined();
  });

  it('treats an admin-only route as no real signal for a non-admin caller', () => {
    expect(resolveSafeTargetPath('/admin/users')).toBeUndefined();
  });

  it('treats a literal root path as no real signal, consistent with the fallback-location resolver', () => {
    expect(resolveSafeTargetPath('/')).toBeUndefined();
  });

  it('strips query and fragment from an otherwise-safe path', () => {
    expect(resolveSafeTargetPath('/explore?left=%5B%5D')).toBe('/explore');
  });
});

describe('extractTargetPathFromEventDetail', () => {
  // Regression test: REQUEST_SIDEBAR_HANDOFF_EVENT's listener used to read
  // `detail?.targetPath` through a bare TypeScript cast with no runtime
  // check. Any script sharing the page can dispatch this custom event, so a
  // malformed detail (e.g. `{ targetPath: 42 }`) previously reached
  // resolveSafeTargetPath and crashed on `.startsWith`, after handleExitToSidebar
  // had already committed side effects (mode change, sidebar open, priorPath
  // consumed) — leaving a half-completed handoff via an unhandled rejection.
  it('extracts a real string targetPath', () => {
    expect(extractTargetPathFromEventDetail({ targetPath: '/connections' })).toBe('/connections');
  });

  it('returns undefined for a non-string targetPath instead of letting it through', () => {
    expect(extractTargetPathFromEventDetail({ targetPath: 42 })).toBeUndefined();
  });

  it('returns undefined when detail has no targetPath', () => {
    expect(extractTargetPathFromEventDetail({})).toBeUndefined();
  });

  it('returns undefined when detail is null or not an object', () => {
    expect(extractTargetPathFromEventDetail(null)).toBeUndefined();
    expect(extractTargetPathFromEventDetail(undefined)).toBeUndefined();
    expect(extractTargetPathFromEventDetail('not-an-object')).toBeUndefined();
  });
});
