/**
 * The automatic section-completion route in `ContentRenderer`, across the reset
 * shapes that all arrive as the same `interactive-progress-cleared` event.
 *
 * The route counts `[data-interactive-section="true"]` nodes inside the
 * renderer's container and compares that against the section ids it has seen
 * complete, so these cases drive it through the container and the real progress
 * event channel rather than through `InteractiveSection`.
 */
import React from 'react';
import { act, render } from '@testing-library/react';

import type { RawContent } from '../../types/content.types';
import { dispatchProgress } from '../../global-state/progress-events';
import { resetContentKeyForTests } from '../../global-state/content-key';
import { StorageEvents } from '../../lib/event-names';
import { ContentRenderer } from './content-renderer';

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string) => fallback,
}));

const GUIDE_URL = 'https://grafana.com/docs/guides/three-sections/';
const SECTION_IDS = ['section-1', 'section-2', 'section-3'];

const content: RawContent = {
  content: '<p>Three passive sections.</p>',
  type: 'single-doc',
  url: GUIDE_URL,
  lastFetched: '2026-07-31T00:00:00.000Z',
  metadata: { title: 'Three sections' },
};

/** Settling time the renderer waits before any progress event may complete. */
const SETTLE_MS = 300;

async function renderWithSections(onGuideComplete: jest.Mock): Promise<void> {
  const containerRef = React.createRef<HTMLDivElement>();
  render(<ContentRenderer content={content} onGuideComplete={onGuideComplete} containerRef={containerRef} />);
  for (const id of SECTION_IDS) {
    const section = document.createElement('div');
    section.setAttribute('data-interactive-section', 'true');
    section.id = id;
    containerRef.current?.appendChild(section);
  }
  // Settles the providers' storage reads as well as the renderer's own
  // settling window; promises are not faked.
  await act(async () => {
    jest.advanceTimersByTime(SETTLE_MS);
  });
}

function completeSection(sectionId: string) {
  act(() => {
    dispatchProgress({ kind: 'section', sectionId, completed: true });
    jest.advanceTimersByTime(SETTLE_MS);
  });
}

async function announceCleared(contentKey: string): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new CustomEvent(StorageEvents.InteractiveProgressCleared, { detail: { contentKey } }));
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  resetContentKeyForTests();
  window.__DocsPluginActiveTabUrl = GUIDE_URL;
});

afterEach(() => {
  jest.useRealTimers();
  localStorage.clear();
  delete window.__DocsPluginActiveTabUrl;
});

describe('ContentRenderer — the automatic section route and reset', () => {
  it('completes the guide once every section has completed', async () => {
    const onGuideComplete = jest.fn();
    await renderWithSections(onGuideComplete);

    completeSection('section-1');
    completeSection('section-2');
    expect(onGuideComplete).not.toHaveBeenCalled();

    completeSection('section-3');

    expect(onGuideComplete).toHaveBeenCalledTimes(1);
  });

  it('keeps the other sections completed when one of them is reset', async () => {
    const onGuideComplete = jest.fn();
    await renderWithSections(onGuideComplete);
    completeSection('section-1');
    completeSection('section-2');

    // A single-section reset announces the guide's key, exactly as a
    // whole-guide reset does.
    await announceCleared(GUIDE_URL);

    completeSection('section-1');
    expect(onGuideComplete).not.toHaveBeenCalled();

    completeSection('section-3');

    expect(onGuideComplete).toHaveBeenCalledTimes(1);
  });

  it('forgets tracked sections when the whole store is cleared, so one section cannot re-complete the guide', async () => {
    const onGuideComplete = jest.fn();
    await renderWithSections(onGuideComplete);
    for (const sectionId of SECTION_IDS) {
      completeSection(sectionId);
    }
    expect(onGuideComplete).toHaveBeenCalledTimes(1);

    await announceCleared('*');

    completeSection('section-1');
    expect(onGuideComplete).toHaveBeenCalledTimes(1);

    completeSection('section-2');
    completeSection('section-3');

    expect(onGuideComplete).toHaveBeenCalledTimes(2);
  });
});
