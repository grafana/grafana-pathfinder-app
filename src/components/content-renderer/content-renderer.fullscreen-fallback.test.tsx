/**
 * Render-level tripwire for `fullScreenFallbackLocation`: `resolveFullScreenFallbackLocation`
 * is unit-tested in isolation, and the hook-level gate in `interactive.hook.test.ts`
 * asserts on a hand-built request object — neither exercises the ~8 recursive
 * `renderParsedElement` call sites in `content-renderer.tsx` that have to thread
 * the value from a manifest all the way into a mounted `<InteractiveStep>`. A
 * single dropped call site here fails silently (the prop is optional, no type
 * error) — the same failure class `content-renderer.prop-forwarding.test.ts`
 * exists to catch for parser-sourced fields, but this value isn't parser-sourced.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import type { RawContent } from '../../types/content.types';
import type { InteractiveElementData } from '../../types/interactive.types';
import { ContentRenderer } from './content-renderer';
import { resetCompletionStoreForTests } from '../../global-state/completion-store';

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string) => fallback,
}));

// Mirrors interactive.hook.test.ts's own mocking boundary (the action-handler
// classes, not the interactive-engine barrel) — the barrel has a circular
// re-export chain that jest.requireActual trips over inside a factory.
// 'navigate' is used for the fixture below specifically because
// executeWithLazyScroll's pre-check (interactive-step.tsx) skips DOM
// resolution entirely for navigate/noop/popout, so this test isn't coupled
// to jsdom's selector/visibility behavior for an unrelated concern.
const mockExecute = jest.fn().mockResolvedValue(undefined);
const mockButtonExecute = jest.fn().mockResolvedValue(undefined);
jest.mock('../../interactive-engine/action-handlers', () => ({
  ButtonHandler: jest.fn().mockImplementation(() => ({ execute: mockButtonExecute })),
  FocusHandler: jest.fn().mockImplementation(() => ({ execute: jest.fn().mockResolvedValue(undefined) })),
  NavigateHandler: jest.fn().mockImplementation(() => ({ execute: mockExecute })),
  FormFillHandler: jest.fn().mockImplementation(() => ({ execute: jest.fn().mockResolvedValue(undefined) })),
  HoverHandler: jest.fn().mockImplementation(() => ({ execute: jest.fn().mockResolvedValue(undefined) })),
  GuidedHandler: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue(undefined),
    executeGuidedStep: jest.fn().mockResolvedValue('completed'),
    cancel: jest.fn(),
  })),
  PopoutHandler: jest.fn().mockImplementation(() => ({ execute: jest.fn().mockResolvedValue(undefined) })),
}));

const mockGetMode = jest.fn<string, []>(() => 'sidebar');
const mockRequestSidebarHandoffAndWait = jest.fn().mockResolvedValue(undefined);
jest.mock('../../global-state/panel-mode', () => {
  const { GRAFANA_DRIVING_ACTIONS } = jest.requireActual('../../constants/interactive-actions');
  return {
    panelModeManager: { getMode: () => mockGetMode() },
    requestSidebarHandoffAndWait: (...args: unknown[]) => mockRequestSidebarHandoffAndWait(...args),
    isGrafanaDrivingHandoffNeeded: (targetAction: string) =>
      mockGetMode() === 'fullscreen' && GRAFANA_DRIVING_ACTIONS.has(targetAction),
  };
});

const GUIDE = {
  id: 'fullscreen-fallback-guide',
  title: 'Fullscreen fallback guide',
  blocks: [
    {
      type: 'interactive',
      action: 'navigate',
      reftarget: '/connections/datasources',
      content: 'Go to data sources',
    },
  ],
};

function renderGuide(content: Partial<RawContent> = {}): void {
  const raw: RawContent = {
    content: JSON.stringify(GUIDE),
    type: 'single-doc',
    url: 'https://grafana.com/docs/guide',
    lastFetched: '2026-08-14T00:00:00.000Z',
    metadata: { title: 'Fullscreen fallback guide' },
    ...content,
  };
  render(<ContentRenderer content={raw} />);
}

describe('fullScreenFallbackLocation reaches a rendered InteractiveStep', () => {
  beforeEach(() => {
    mockExecute.mockClear();
  });

  it('threads the course-level manifest startingLocation into the "Do it" click', async () => {
    renderGuide({
      metadata: {
        title: 'Fullscreen fallback guide',
        packageManifest: { startingLocation: '/connections' },
      },
    });

    fireEvent.click(screen.getByText('Go there'));

    await waitFor(() => expect(mockExecute).toHaveBeenCalled());
    const elementData = mockExecute.mock.calls[0]![0] as InteractiveElementData;
    expect(elementData.fullScreenFallbackLocation).toBe('/connections');
  });

  it('leaves it undefined when no manifest starting location is authored', async () => {
    renderGuide();

    fireEvent.click(screen.getByText('Go there'));

    await waitFor(() => expect(mockExecute).toHaveBeenCalled());
    const elementData = mockExecute.mock.calls[0]![0] as InteractiveElementData;
    expect(elementData.fullScreenFallbackLocation).toBeUndefined();
  });

  it('treats a manifest startingLocation of "/" as no real signal, per resolveFullScreenFallbackLocation', async () => {
    renderGuide({
      metadata: {
        title: 'Fullscreen fallback guide',
        packageManifest: { startingLocation: '/' },
      },
    });

    fireEvent.click(screen.getByText('Go there'));

    await waitFor(() => expect(mockExecute).toHaveBeenCalled());
    const elementData = mockExecute.mock.calls[0]![0] as InteractiveElementData;
    expect(elementData.fullScreenFallbackLocation).toBeUndefined();
  });
});

const BUTTON_GUIDE = {
  id: 'fullscreen-handoff-button-guide',
  title: 'Fullscreen handoff button guide',
  blocks: [
    {
      type: 'interactive',
      action: 'button',
      reftarget: 'button.does-not-exist-in-fullscreen',
      content: 'Save the thing',
    },
  ],
};

function renderButtonGuide(): void {
  const raw: RawContent = {
    content: JSON.stringify(BUTTON_GUIDE),
    type: 'single-doc',
    url: 'https://grafana.com/docs/guide',
    lastFetched: '2026-08-14T00:00:00.000Z',
    metadata: { title: 'Fullscreen handoff button guide' },
  };
  render(<ContentRenderer content={raw} />);
}

describe('full-screen handoff gate reaches the handler for non-navigate actions', () => {
  beforeEach(() => {
    mockButtonExecute.mockClear();
    mockRequestSidebarHandoffAndWait.mockClear();
    mockGetMode.mockReturnValue('sidebar');
    localStorage.clear();
    resetCompletionStoreForTests();
  });

  // Regression test for a real bug: executeWithLazyScroll's fast DOM-existence
  // precheck ran before the fullscreen gate for every action except
  // navigate/noop/popout, so in full screen (no live Grafana DOM to find a
  // button in) the precheck always failed first and the gate — and the
  // handler — were never reached. Only navigate ever worked. This proves a
  // `button` step's "Do it" click now reaches both the handoff and the
  // handler even though no matching element exists in jsdom.
  it('reaches the handoff and the handler for a "button" action with no live DOM target', async () => {
    mockGetMode.mockReturnValue('fullscreen');
    renderButtonGuide();

    fireEvent.click(screen.getByText('Do it'));

    await waitFor(() => expect(mockRequestSidebarHandoffAndWait).toHaveBeenCalled());
    await waitFor(() => expect(mockButtonExecute).toHaveBeenCalled());
  });

  // "Show me" applies the exact same rule as "Do it": it has nothing to
  // preview until the live Grafana UI is docked into view either. Before this
  // fix, isGrafanaDrivingHandoffNeeded excluded buttonType 'show' entirely, so
  // a "Show me" click in full screen never handed off and just failed with
  // "Element not found".
  it('reaches the handoff and the handler for a "button" action\'s "Show me" click too', async () => {
    mockGetMode.mockReturnValue('fullscreen');
    renderButtonGuide();

    fireEvent.click(screen.getByText('Show me'));

    await waitFor(() => expect(mockRequestSidebarHandoffAndWait).toHaveBeenCalled());
    await waitFor(() => expect(mockButtonExecute).toHaveBeenCalled());
  });

  it('does not perform the handoff outside full screen, and the real precheck still runs (regression guard)', async () => {
    mockGetMode.mockReturnValue('sidebar');
    renderButtonGuide();

    fireEvent.click(screen.getByText('Do it'));

    // Outside full screen, isGrafanaDrivingHandoffNeeded is false, so
    // executeWithLazyScroll's real precheck runs unmodified — it correctly
    // reports the element as not found (same as before this fix), proving
    // the bypass is scoped to the fullscreen+driving-action case only.
    await waitFor(() => expect(screen.getByText(/Element not found/)).toBeInTheDocument());
    expect(mockButtonExecute).not.toHaveBeenCalled();
    expect(mockRequestSidebarHandoffAndWait).not.toHaveBeenCalled();
  });
});
