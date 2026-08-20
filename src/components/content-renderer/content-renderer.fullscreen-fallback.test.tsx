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
jest.mock('../../interactive-engine/action-handlers', () => ({
  ButtonHandler: jest.fn().mockImplementation(() => ({ execute: jest.fn().mockResolvedValue(undefined) })),
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
