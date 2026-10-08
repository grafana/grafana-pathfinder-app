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
import { dispatchProgress, subscribeProgressEvent, type ProgressEventDetail } from '../../global-state/progress-events';
import { resetContentKeyForTests } from '../../global-state/content-key';
import { StorageEvents } from '../../lib/event-names';
import { interactiveStepStorage } from '../../lib/user-storage';
import { resetCompletionStoreForTests } from '../../global-state/completion-store';
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

function completeSection(sectionId: string, contentKey: string = GUIDE_URL, hydrated = false) {
  act(() => {
    dispatchProgress({ kind: 'section', contentKey, sectionId, completed: true, hydrated });
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
  resetCompletionStoreForTests();
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
    expect(onGuideComplete).toHaveBeenCalledWith('objectives', GUIDE_URL);
  });

  it('counts a hydrated section toward the tally without letting it complete the guide', async () => {
    const onGuideComplete = jest.fn();
    await renderWithSections(onGuideComplete);

    completeSection('section-1', GUIDE_URL, true);
    completeSection('section-2', GUIDE_URL, true);
    completeSection('section-3', GUIDE_URL, true);
    expect(onGuideComplete).not.toHaveBeenCalled();

    // A reader's completion of any section now finds the tally already full.
    completeSection('section-3');
    expect(onGuideComplete).toHaveBeenCalledTimes(1);
  });

  it('completes the guide when a reader finishes the last section of a partly hydrated tally', async () => {
    const onGuideComplete = jest.fn();
    await renderWithSections(onGuideComplete);

    completeSection('section-1', GUIDE_URL, true);
    completeSection('section-2', GUIDE_URL, true);
    expect(onGuideComplete).not.toHaveBeenCalled();

    completeSection('section-3');
    expect(onGuideComplete).toHaveBeenCalledTimes(1);
    expect(onGuideComplete).toHaveBeenCalledWith('objectives', GUIDE_URL);
  });

  it('ignores sections from another guide, including ones whose ids match its own', async () => {
    const onGuideComplete = jest.fn();
    await renderWithSections(onGuideComplete);
    const previewKey = 'block-editor://preview/other-guide';

    for (const sectionId of [...SECTION_IDS, 'preview-section-1']) {
      completeSection(sectionId, previewKey);
    }
    expect(onGuideComplete).not.toHaveBeenCalled();

    SECTION_IDS.forEach((sectionId) => completeSection(sectionId));
    expect(onGuideComplete).toHaveBeenCalledTimes(1);
    expect(onGuideComplete).toHaveBeenCalledWith('objectives', GUIDE_URL);
  });

  it('matches its own guide key regardless of a trailing slash', async () => {
    const onGuideComplete = jest.fn();
    await renderWithSections(onGuideComplete);
    const slashToggled = GUIDE_URL.endsWith('/') ? GUIDE_URL.slice(0, -1) : `${GUIDE_URL}/`;
    SECTION_IDS.forEach((sectionId) => completeSection(sectionId, slashToggled));
    expect(onGuideComplete).toHaveBeenCalledTimes(1);
  });

  it('reports skipped when automatic completion includes a restored skipped step', async () => {
    await interactiveStepStorage.setCompleted(GUIDE_URL, 'section-1', new Set(['step-1']), new Set(['step-1']));
    const onGuideComplete = jest.fn();
    await renderWithSections(onGuideComplete);
    SECTION_IDS.forEach((sectionId) => completeSection(sectionId));
    expect(onGuideComplete).toHaveBeenCalledWith('skipped', GUIDE_URL);
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

  it('tags the section event a mounted section dispatches with the renderer own key', async () => {
    const sections: ProgressEventDetail[] = [];
    const unsubscribe = subscribeProgressEvent((detail) => {
      if (detail.kind === 'section') {
        sections.push(detail);
      }
    });
    const guide: RawContent = {
      ...content,
      content: JSON.stringify({
        id: 'owner-key-guide',
        title: 'Owner key guide',
        blocks: [
          {
            type: 'section',
            id: 'owned-section',
            title: 'Owned',
            blocks: [{ type: 'interactive', action: 'noop', content: 'Read me.' }],
          },
        ],
      }),
    };
    try {
      render(<ContentRenderer content={guide} />);
      await act(async () => {
        jest.advanceTimersByTime(SETTLE_MS);
      });

      expect(sections).toEqual([
        expect.objectContaining({ kind: 'section', sectionId: 'section-owned-section', contentKey: GUIDE_URL }),
      ]);
    } finally {
      unsubscribe();
    }
  });

  it.each([
    ['this guide', GUIDE_URL],
    ['every guide', '*'],
  ])('leaves the route alone when a reset clears %s, so no clear can re-complete it', async (_label, clearedKey) => {
    const onGuideComplete = jest.fn();
    await renderWithSections(onGuideComplete);
    for (const sectionId of SECTION_IDS) {
      completeSection(sectionId);
    }
    expect(onGuideComplete).toHaveBeenCalledTimes(1);

    await announceCleared(clearedKey);
    for (const sectionId of SECTION_IDS) {
      completeSection(sectionId);
    }

    expect(onGuideComplete).toHaveBeenCalledTimes(1);
  });
});
