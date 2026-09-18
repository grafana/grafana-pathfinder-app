/**
 * The Mark complete control is unconditional (COMPLETION-MODEL.md, decision 2).
 *
 * These cases assert PRESENCE across the shapes a predicate-based design would
 * have excluded — a prose-only guide, a guide that already ends on a completable
 * block, a milestone, a block-editor preview. There is deliberately no case
 * asserting absence for a guide shape; such a test would re-encode the
 * predicate the model deleted. The one absence covered is a path's cover page,
 * which is a table of contents rather than a guide.
 *
 * The persistence cases run against the real content-key resolution and the
 * real storage namespace, because which key a click writes under is exactly
 * what a mocked resolver cannot prove.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { RawContent } from '../../types/content.types';
import { testIds } from '../../constants/testIds';
import { UserInteraction } from '../../lib/analytics';
import { dispatchProgress } from '../../global-state/progress-events';
import { resetContentKeyForTests } from '../../global-state/content-key';
import { guideCompletionMarkStorage } from '../../lib/user-storage';
import { StorageEvents } from '../../lib/event-names';
import { ContentRenderer } from './content-renderer';

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string) => fallback,
}));

const reportAppInteraction = jest.fn();
jest.mock('../../lib/analytics', () => ({
  ...jest.requireActual('../../lib/analytics'),
  reportAppInteraction: (...args: unknown[]) => reportAppInteraction(...args),
}));

function markCompleteEvents(): unknown[][] {
  return reportAppInteraction.mock.calls.filter(([interaction]) => interaction === UserInteraction.MarkCompleteClicked);
}

const baseUrl = 'https://grafana.com/docs/learning-paths/demo';
const milestones = [{ number: 1, title: 'Set up', duration: '', url: `${baseUrl}/set-up/`, isActive: false }];
const PREVIEW_URL = 'block-editor://preview/demo';

const PROSE_ONLY = '<p>Nothing to click here, only words.</p>';
const WITH_INTERACTIVE_STEP =
  '<li class="interactive" data-targetaction="highlight" data-reftarget="a[href=\'/dashboards\']">Open dashboards</li>';

function makeContent(overrides: Partial<RawContent> = {}): RawContent {
  return {
    content: PROSE_ONLY,
    type: 'single-doc',
    url: `${baseUrl}/set-up/`,
    lastFetched: '2026-07-31T00:00:00.000Z',
    metadata: { title: 'Demo' },
    ...overrides,
  };
}

/** The shape `BlockPreview` builds: a journey with no milestone metadata. */
function makePreview(): RawContent {
  return makeContent({ type: 'learning-journey', url: PREVIEW_URL });
}

function makeMilestone(currentMilestone = 1): RawContent {
  return makeContent({
    type: 'learning-journey',
    metadata: {
      title: 'Demo',
      learningJourney: { currentMilestone, totalMilestones: milestones.length, milestones, baseUrl },
    },
  });
}

/** The control is clickable only once the stored mark has been read. */
async function clickWhenReady(): Promise<void> {
  const button = await screen.findByTestId(testIds.markComplete.button);
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  resetContentKeyForTests();
  delete window.__DocsPluginActiveTabUrl;
  delete window.__DocsPluginContentKey;
});

afterEach(() => {
  jest.useRealTimers();
  localStorage.clear();
  delete window.__DocsPluginActiveTabUrl;
  delete window.__DocsPluginContentKey;
});

describe('ContentRenderer — the universal Mark complete control', () => {
  it.each([
    ['a prose-only guide', makeContent()],
    ['a guide with interactive steps', makeContent({ content: WITH_INTERACTIVE_STEP })],
    ['a milestone', makeMilestone()],
    ['a block-editor preview', makePreview()],
  ])('renders on %s', (_label, content) => {
    render(<ContentRenderer content={content} />);

    expect(screen.getByTestId(testIds.markComplete.button)).toBeInTheDocument();
  });

  it('labels the milestone form "Mark complete and continue" when there is somewhere to continue to', () => {
    render(<ContentRenderer content={makeMilestone()} onContinueToNextMilestone={jest.fn()} />);

    expect(screen.getByTestId(testIds.markComplete.button)).toHaveTextContent('Mark complete and continue');
  });

  it('labels a standalone guide "Mark complete"', () => {
    render(<ContentRenderer content={makeContent()} />);

    expect(screen.getByTestId(testIds.markComplete.button)).toHaveTextContent('Mark complete');
  });

  it('omits the control on a path cover page, which is a table of contents rather than a guide', () => {
    render(<ContentRenderer content={makeMilestone(0)} />);

    expect(screen.queryByTestId(testIds.markComplete.button)).not.toBeInTheDocument();
  });

  it('marks the guide the reader is actually on', async () => {
    const content = makeContent();
    window.__DocsPluginActiveTabUrl = content.url;
    render(<ContentRenderer content={content} onGuideComplete={jest.fn()} />);

    await clickWhenReady();

    await waitFor(async () => expect(await guideCompletionMarkStorage.get(content.url)).toBe(true));
  });

  it('re-resolves the key when the guide changes, so a mark lands on the new milestone', async () => {
    const first = makeMilestone();
    window.__DocsPluginActiveTabUrl = first.url;
    const { rerender } = render(<ContentRenderer content={first} onGuideComplete={jest.fn()} />);
    await screen.findByTestId(testIds.markComplete.button);

    const second = makeContent({ url: `${baseUrl}/configure/` });
    window.__DocsPluginActiveTabUrl = second.url;
    rerender(<ContentRenderer content={second} onGuideComplete={jest.fn()} />);

    await clickWhenReady();

    await waitFor(async () => expect(await guideCompletionMarkStorage.get(second.url)).toBe(true));
    expect(await guideCompletionMarkStorage.get(first.url)).toBeNull();
  });

  it('records nothing at all from a block-editor preview', async () => {
    // A docs panel holding a real guide can be open alongside the editor, and
    // its active tab URL is the ambient content key.
    const openGuideUrl = `${baseUrl}/set-up/`;
    window.__DocsPluginActiveTabUrl = openGuideUrl;
    const onGuideComplete = jest.fn();
    render(<ContentRenderer content={makePreview()} onGuideComplete={onGuideComplete} />);

    await clickWhenReady();

    // The durable completion record is the one irreversible side effect, so it
    // belongs behind the same guard as the mark and the analytics event.
    expect(onGuideComplete).not.toHaveBeenCalled();
    expect(markCompleteEvents()).toEqual([]);
    expect(await guideCompletionMarkStorage.get(PREVIEW_URL)).toBeNull();
    expect(await guideCompletionMarkStorage.get(openGuideUrl)).toBeNull();
  });

  it('treats a real guide whose URL merely contains "devtools" as a real guide', async () => {
    const content = makeContent({ url: `${baseUrl}/devtools-setup/` });
    window.__DocsPluginActiveTabUrl = content.url;
    const onGuideComplete = jest.fn();
    render(<ContentRenderer content={content} onGuideComplete={onGuideComplete} />);

    await clickWhenReady();

    expect(onGuideComplete).toHaveBeenCalledTimes(1);
    expect(markCompleteEvents()).toHaveLength(1);
    await waitFor(async () => expect(await guideCompletionMarkStorage.get(content.url)).toBe(true));
  });

  it.each([
    ['guide', makeContent()],
    ['milestone', makeMilestone()],
  ])('reports one %s click with that discriminator', async (discriminator, content) => {
    window.__DocsPluginActiveTabUrl = content.url;
    render(<ContentRenderer content={content} onGuideComplete={jest.fn()} />);

    await clickWhenReady();

    expect(markCompleteEvents()).toEqual([
      [
        UserInteraction.MarkCompleteClicked,
        {
          interaction_location: 'content_footer',
          completion_context: discriminator,
          completion_percentage_before: 0,
        },
      ],
    ]);
  });

  it('reports a URL-typed standalone tutorial as a guide, matching how its completion is recorded', async () => {
    // `determineContentType` types any /tutorials/ URL as a journey, but with
    // no journey metadata the completion is recorded as a standalone guide.
    const content = makeContent({ type: 'learning-journey', url: 'https://grafana.com/docs/tutorials/foo/' });
    window.__DocsPluginActiveTabUrl = content.url;
    render(<ContentRenderer content={content} onGuideComplete={jest.fn()} />);

    await clickWhenReady();

    expect(markCompleteEvents()).toEqual([
      [UserInteraction.MarkCompleteClicked, expect.objectContaining({ completion_context: 'guide' })],
    ]);
  });

  it('records a completion again after a reset re-arms the control', async () => {
    const content = makeContent();
    window.__DocsPluginActiveTabUrl = content.url;
    const onGuideComplete = jest.fn();
    render(<ContentRenderer content={content} onGuideComplete={onGuideComplete} />);

    await clickWhenReady();
    expect(onGuideComplete).toHaveBeenCalledTimes(1);
    await waitFor(async () => expect(await guideCompletionMarkStorage.get(content.url)).toBe(true));

    // What every reset path does: drop the mark, then announce the clear.
    await act(async () => {
      await guideCompletionMarkStorage.clearAllWithPrefix();
      window.dispatchEvent(new CustomEvent(StorageEvents.InteractiveProgressCleared, { detail: { contentKey: '*' } }));
    });

    await clickWhenReady();

    expect(onGuideComplete).toHaveBeenCalledTimes(2);
    await waitFor(async () => expect(await guideCompletionMarkStorage.get(content.url)).toBe(true));
  });

  it('records one completion when a clear is followed by the automatic route and then a click', async () => {
    jest.useFakeTimers();
    const onGuideComplete = jest.fn();
    const content = makeContent();
    window.__DocsPluginActiveTabUrl = content.url;
    render(<ContentRenderer content={content} onGuideComplete={onGuideComplete} />);
    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    // A per-section reset announces the guide's key without the guide having
    // been marked, so the re-arm is pending when the automatic route lands.
    act(() => {
      window.dispatchEvent(
        new CustomEvent(StorageEvents.InteractiveProgressCleared, { detail: { contentKey: content.url } })
      );
    });
    act(() => {
      dispatchProgress({ kind: 'guide', contentKey: content.url, percentage: 100, hasProgress: true });
    });
    expect(onGuideComplete).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId(testIds.markComplete.button));

    expect(onGuideComplete).toHaveBeenCalledTimes(1);
  });

  it('records one completion when the click is followed by the automatic route', async () => {
    jest.useFakeTimers();
    const onGuideComplete = jest.fn();
    const content = makeContent();
    window.__DocsPluginActiveTabUrl = content.url;
    render(<ContentRenderer content={content} onGuideComplete={onGuideComplete} />);

    // The renderer ignores progress events until content settles; the async
    // act also settles the footer's stored-mark read.
    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    fireEvent.click(screen.getByTestId(testIds.markComplete.button));
    act(() => {
      dispatchProgress({ kind: 'guide', contentKey: content.url, percentage: 100, hasProgress: true });
    });

    expect(onGuideComplete).toHaveBeenCalledTimes(1);
  });
});
