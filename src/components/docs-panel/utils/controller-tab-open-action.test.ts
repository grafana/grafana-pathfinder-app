import { buildControllerTabUrl, pickControllerTabOpenAction } from './controller-tab-open-action';

describe('pickControllerTabOpenAction', () => {
  it('returns shouldShow=false without a url', () => {
    expect(pickControllerTabOpenAction(undefined, 'interactive')).toEqual({ shouldShow: false });
  });

  it('returns shouldShow=false for non-interactive tab types', () => {
    expect(pickControllerTabOpenAction('backend-guide:x', 'docs')).toEqual({ shouldShow: false });
    expect(pickControllerTabOpenAction('backend-guide:x', undefined)).toEqual({ shouldShow: false });
  });

  it('builds a same-origin controller URL for an interactive tab', () => {
    const result = pickControllerTabOpenAction('backend-guide:my-guide', 'interactive');
    expect(result.shouldShow).toBe(true);
    expect(result.createControllerUrl).toEqual(expect.any(Function));
  });

  it('puts pairing material in the URL fragment', () => {
    const controllerUrl = buildControllerTabUrl('backend-guide:my-guide', {
      pairingId: 'pairing-1',
      pairingSecret: 'secret-1',
      pairingCode: '123456',
    });
    const url = new URL(controllerUrl, 'http://localhost');
    expect(url.pathname).toBe('/');
    expect(url.searchParams.get('doc')).toBe('backend-guide:my-guide');
    expect(url.searchParams.get('controller')).toBe('1');
    expect(url.searchParams.get('readonly')).toBeNull();
    expect(url.hash).toBe('#pairing_id=pairing-1&pairing_secret=secret-1&pairing_code=123456');
  });

  it('shows for an interactive guide regardless of url scheme (e.g. bundled)', () => {
    expect(pickControllerTabOpenAction('bundled:alerting-101', 'interactive').shouldShow).toBe(true);
  });
});
