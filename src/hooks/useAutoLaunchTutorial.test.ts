/**
 * Tests for the shared `auto-launch-tutorial` listener hook used by the
 * sidebar, floating panel, and fullscreen panel.
 *
 * The hook owns the routing decision (`shouldOpenAsLearningJourney`) and
 * the source-coercion boundary (`coerceLaunchSource`) so all surfaces
 * agree on what the event means. These tests pin the routing matrix down
 * and verify the optional callbacks fire at the right time.
 */

import { renderHook } from '@testing-library/react';
import { useAutoLaunchTutorial, type AutoLaunchPanel } from './useAutoLaunchTutorial';

function makePanel() {
  return {
    openLearningJourney: jest.fn(),
    openDocsPage: jest.fn(),
  };
}

function asPanel(panel: ReturnType<typeof makePanel>): AutoLaunchPanel {
  return panel as unknown as AutoLaunchPanel;
}

function dispatchAutoLaunch(detail?: { url?: string; title?: string; type?: string; source?: string }) {
  document.dispatchEvent(new CustomEvent('auto-launch-tutorial', { detail }));
}

describe('useAutoLaunchTutorial', () => {
  it('routes type=learning-journey through openLearningJourney', () => {
    const panel = makePanel();
    renderHook(() => useAutoLaunchTutorial(asPanel(panel)));

    dispatchAutoLaunch({
      url: 'https://grafana.com/docs/learning-journeys/foo',
      title: 'Foo',
      type: 'learning-journey',
      source: 'url_param',
    });

    expect(panel.openLearningJourney).toHaveBeenCalledWith(
      'https://grafana.com/docs/learning-journeys/foo',
      'Foo',
      // url_param is a recognised LaunchSource and should pass through.
      expect.objectContaining({ source: 'url_param' })
    );
    expect(panel.openDocsPage).not.toHaveBeenCalled();
  });

  it('routes source=learning-hub through openLearningJourney even when type is omitted', () => {
    const panel = makePanel();
    renderHook(() => useAutoLaunchTutorial(asPanel(panel)));

    dispatchAutoLaunch({ url: 'bundled:foo', title: 'Foo', source: 'learning-hub' });

    expect(panel.openLearningJourney).toHaveBeenCalled();
    expect(panel.openDocsPage).not.toHaveBeenCalled();
  });

  it('routes everything else through openDocsPage', () => {
    const panel = makePanel();
    renderHook(() => useAutoLaunchTutorial(asPanel(panel)));

    dispatchAutoLaunch({ url: 'bundled:foo', title: 'Foo', type: 'docs' });

    expect(panel.openDocsPage).toHaveBeenCalledWith(
      'bundled:foo',
      'Foo',
      expect.objectContaining({ source: undefined })
    );
    expect(panel.openLearningJourney).not.toHaveBeenCalled();
  });

  it('coerces unknown source strings to undefined at the boundary (no typo poisoning)', () => {
    const panel = makePanel();
    renderHook(() => useAutoLaunchTutorial(asPanel(panel)));

    dispatchAutoLaunch({ url: 'bundled:foo', title: 'Foo', type: 'docs', source: 'totally-unknown-source' });

    // The hook calls `coerceLaunchSource` which returns null for unknown
    // literals; the hook then converts that to undefined before passing on.
    expect(panel.openDocsPage).toHaveBeenCalledWith('bundled:foo', 'Foo', { source: undefined });
  });

  it('skips the panel call when url/title are missing but still fires onIncoming', () => {
    const panel = makePanel();
    const onIncoming = jest.fn();
    renderHook(() => useAutoLaunchTutorial(asPanel(panel), { onIncoming }));

    dispatchAutoLaunch({ url: '', title: 'Foo' });

    expect(onIncoming).toHaveBeenCalledTimes(1);
    expect(panel.openDocsPage).not.toHaveBeenCalled();
    expect(panel.openLearningJourney).not.toHaveBeenCalled();
  });

  it('fires onIncoming synchronously before the panel is mutated (in-flight gate use case)', () => {
    const panel = makePanel();
    const order: string[] = [];
    const onIncoming = jest.fn(() => {
      order.push('onIncoming');
    });
    panel.openDocsPage.mockImplementation(() => {
      order.push('open');
    });

    renderHook(() => useAutoLaunchTutorial(asPanel(panel), { onIncoming }));
    dispatchAutoLaunch({ url: 'bundled:foo', title: 'Foo', type: 'docs' });

    expect(order).toEqual(['onIncoming', 'open']);
  });

  it('fires onLaunched after the panel call with the openedAsLearningJourney flag', () => {
    const panel = makePanel();
    const onLaunched = jest.fn();
    renderHook(() => useAutoLaunchTutorial(asPanel(panel), { onLaunched }));

    dispatchAutoLaunch({ url: 'bundled:foo', title: 'Foo', type: 'learning-journey' });
    expect(onLaunched).toHaveBeenCalledWith(expect.objectContaining({ url: 'bundled:foo' }), true);

    dispatchAutoLaunch({ url: 'bundled:bar', title: 'Bar', type: 'docs' });
    expect(onLaunched).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'bundled:bar' }), false);
  });

  it('does NOT fire onLaunched when url/title are missing (it represents a routed event)', () => {
    const panel = makePanel();
    const onLaunched = jest.fn();
    renderHook(() => useAutoLaunchTutorial(asPanel(panel), { onLaunched }));

    dispatchAutoLaunch({ url: '', title: 'Foo' });

    expect(onLaunched).not.toHaveBeenCalled();
  });

  it('unsubscribes on unmount so re-mounts do not double-route', () => {
    const panel = makePanel();
    const { unmount } = renderHook(() => useAutoLaunchTutorial(asPanel(panel)));

    unmount();
    dispatchAutoLaunch({ url: 'bundled:foo', title: 'Foo', type: 'docs' });

    expect(panel.openDocsPage).not.toHaveBeenCalled();
  });
});
