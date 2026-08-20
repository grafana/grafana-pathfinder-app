import { resolveSafeTargetPath } from './resolve-safe-target-path';

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
