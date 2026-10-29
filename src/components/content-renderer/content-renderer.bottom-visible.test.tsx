/**
 * A guide with no completable block completes when the end of its content is
 * seen; a guide with one ignores it (#2258). The observer is driven by hand:
 * jsdom has no layout, so what is asserted is the gating around it.
 */
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';

import type { RawContent } from '../../types/content.types';
import { testIds } from '../../constants/testIds';
import { UserInteraction } from '../../lib/analytics';
import { resetContentKeyForTests } from '../../global-state/content-key';
import {
  guideCompletionMarkStorage,
  guideResponseStorage,
  interactiveCompletionStorage,
  interactiveStepStorage,
} from '../../lib/user-storage';
import { StorageKeys } from '../../lib/storage-keys';
import { STANDALONE_SECTION_ID, evictAllContentCaches, peekGuidePercentage } from '../../global-state/completion-store';
import { recordGuideCompletionForSurface } from '../../docs-retrieval';
import { UNTRACKED_COMPLETION, trackedCompletion } from '../../test-utils/content-renderer-completion';
import { ContentRenderer } from './content-renderer';

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string) => fallback,
}));

const reportAppInteraction = jest.fn();
jest.mock('../../lib/analytics', () => ({
  ...jest.requireActual('../../lib/analytics'),
  reportAppInteraction: (...args: unknown[]) => reportAppInteraction(...args),
}));

jest.mock('../../docs-retrieval', () => ({
  ...jest.requireActual('../../docs-retrieval'),
  recordGuideCompletionForSurface: jest.fn(),
}));

const recordCompletion = jest.mocked(recordGuideCompletionForSurface);

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(public callback: IntersectionObserverCallback) {
    MockIntersectionObserver.instances.push(this);
  }
  observe(target: Element) {
    this.observed.push(target);
  }
  disconnect() {
    this.disconnected = true;
  }
  intersect(isIntersecting: boolean) {
    this.callback([{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

function liveObserver(): MockIntersectionObserver | undefined {
  return MockIntersectionObserver.instances.find(
    (observer) =>
      !observer.disconnected && observer.observed.some((el) => el.getAttribute('data-testid') === 'guide-end-sentinel')
  );
}

async function seeEnd(isIntersecting = true): Promise<void> {
  await waitFor(() => expect(liveObserver()).toBeDefined());
  act(() => liveObserver()!.intersect(isIntersecting));
  await act(async () => {});
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

const URL = 'https://grafana.com/docs/grafana/latest/fundamentals/';

function makeDocsPage(overrides: Partial<RawContent> = {}): RawContent {
  return {
    content: '<p>Only words.</p>',
    type: 'single-doc',
    url: URL,
    lastFetched: '2026-10-29T00:00:00.000Z',
    metadata: { title: 'Fundamentals' },
    ...overrides,
  };
}

function makeJsonGuide(blocks: unknown[], url = 'bundled:bottom-visible'): RawContent {
  return makeDocsPage({
    url,
    type: 'interactive',
    isNativeJson: true,
    content: JSON.stringify({ id: 'bottom-visible', title: 'Bottom visible', blocks }),
  });
}

const markdown = (id: string) => ({ type: 'markdown', id, content: `Paragraph ${id}` });

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  resetContentKeyForTests();
  setVisibility('visible');
  MockIntersectionObserver.instances = [];
  (global as unknown as { IntersectionObserver: unknown }).IntersectionObserver = MockIntersectionObserver;
});

afterEach(() => {
  jest.restoreAllMocks();
  delete (global as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
  setVisibility('visible');
  evictAllContentCaches();
  localStorage.clear();
});

describe('a docs page', () => {
  it('flips its footer to completed once its end is seen, recording as objectives with a duration', async () => {
    const content = makeDocsPage();
    render(<ContentRenderer content={content} completion={trackedCompletion(content)} />);

    await seeEnd();

    expect(await screen.findByTestId(testIds.markComplete.completed)).toBeInTheDocument();
    expect(guideCompletionMarkStorage.isViewed(URL)).toBe(true);
    expect(recordCompletion).toHaveBeenCalledTimes(1);
    expect(recordCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'objectives', durationMs: expect.any(Number) })
    );
    expect(
      reportAppInteraction.mock.calls.filter(([interaction]) => interaction === UserInteraction.MarkCompleteClicked)
    ).toHaveLength(0);
  });

  it('stays incomplete while its end is out of view', async () => {
    const content = makeDocsPage();
    render(<ContentRenderer content={content} completion={trackedCompletion(content)} />);

    await seeEnd(false);

    expect(guideCompletionMarkStorage.isMarked(URL)).toBe(false);
    expect(recordCompletion).not.toHaveBeenCalled();
    expect(screen.getByTestId(testIds.markComplete.button)).toBeInTheDocument();
  });

  it('latches: a second sighting records nothing more', async () => {
    const content = makeDocsPage();
    render(<ContentRenderer content={content} completion={trackedCompletion(content)} />);

    await seeEnd();
    const observer = MockIntersectionObserver.instances.at(-1)!;
    act(() => observer.intersect(true));

    expect(observer.disconnected).toBe(true);
    expect(recordCompletion).toHaveBeenCalledTimes(1);
  });

  it('does not count a sighting while the browser tab is hidden', async () => {
    setVisibility('hidden');
    const content = makeDocsPage();
    render(<ContentRenderer content={content} completion={trackedCompletion(content)} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(liveObserver()).toBeUndefined();

    setVisibility('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await seeEnd();

    expect(guideCompletionMarkStorage.isViewed(URL)).toBe(true);
  });

  it('waits for images to settle before watching the end', async () => {
    const content = makeDocsPage({ content: '<p>Words.</p><img src="https://grafana.com/a.png" alt="A" />' });
    const complete = jest.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(false);
    render(<ContentRenderer content={content} completion={trackedCompletion(content)} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(liveObserver()).toBeUndefined();

    complete.mockRestore();
    act(() => {
      document.querySelectorAll('img').forEach((img) => img.dispatchEvent(new Event('error')));
    });
    await seeEnd();

    expect(guideCompletionMarkStorage.isViewed(URL)).toBe(true);
  });
});

describe('a JSON guide', () => {
  it('completes a prose-only guide when its end is seen', async () => {
    const content = makeJsonGuide([markdown('a'), markdown('b')]);
    render(<ContentRenderer content={content} completion={trackedCompletion(content)} />);

    await seeEnd();

    await waitFor(() => expect(peekGuidePercentage(content.url)).toBe(100));
    expect(recordCompletion).toHaveBeenCalledWith(expect.objectContaining({ source: 'objectives' }));
  });

  it('ignores its end for a guide with a completable block', async () => {
    const content = makeJsonGuide([
      { type: 'interactive', id: 'open', action: 'noop', content: 'Open dashboards' },
      markdown('outro'),
    ]);
    render(<ContentRenderer content={content} completion={trackedCompletion(content)} />);

    await seeEnd();

    expect(guideCompletionMarkStorage.isMarked(content.url)).toBe(false);
    expect(recordCompletion).not.toHaveBeenCalled();
  });
});

it('never watches the end of a block-editor preview', async () => {
  const content = makeDocsPage({ type: 'learning-journey', url: 'block-editor://preview/demo' });
  render(<ContentRenderer content={content} completion={UNTRACKED_COMPLETION} />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  expect(liveObserver()).toBeUndefined();
  expect(guideCompletionMarkStorage.isMarked(content.url)).toBe(false);
});

describe('a guide that opens at 100%', () => {
  const finishedGuide = (url: string) =>
    makeJsonGuide(
      [{ type: 'interactive', id: 'open', action: 'noop', content: 'Open dashboards' }, markdown('outro')],
      url
    );

  async function seedFinishedLastStep(url: string, persisted: number): Promise<void> {
    await interactiveStepStorage.setCompleted(url, STANDALONE_SECTION_ID, new Set(['open']));
    localStorage.setItem(StorageKeys.INTERACTIVE_COMPLETION, JSON.stringify({ [url]: persisted }));
  }

  async function settle(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
  }

  it('records once, without a duration, when this load first takes it to 100%', async () => {
    const content = finishedGuide('bundled:opens-at-99');
    await seedFinishedLastStep(content.url, 99);
    render(<ContentRenderer content={content} completion={trackedCompletion(content)} />);

    await waitFor(() => expect(recordCompletion).toHaveBeenCalledTimes(1));
    await settle();
    expect(recordCompletion).toHaveBeenCalledTimes(1);
    const [input] = recordCompletion.mock.calls[0]!;
    expect(input.source).toBe('objectives');
    expect(input.durationMs).toBeUndefined();
    expect(interactiveCompletionStorage.peekAll()[content.url]).toBe(100);
  });

  it('records once when a choice guide crosses to 100% only after its responses arrive', async () => {
    const content = makeJsonGuide(
      [
        {
          type: 'input',
          inputType: 'checkbox-group',
          prompt: 'Signals?',
          variableName: 'signals',
          choices: [{ id: 'logs', text: 'Logs' }],
        },
        { type: 'interactive', id: 'open', action: 'noop', content: 'Open dashboards' },
        markdown('outro'),
        {
          type: 'section',
          id: 'logs',
          requirements: ['var-signals:includes:logs'],
          whenRequirementsUnmet: 'hide',
          blocks: [markdown('logs-step')],
        },
      ],
      'bundled:choice-opens-at-99'
    );
    jest.spyOn(guideResponseStorage, 'getForGuide').mockResolvedValue({ signals: 'logs' });
    await seedFinishedLastStep(content.url, 99);
    render(<ContentRenderer content={content} completion={trackedCompletion(content)} />);

    await waitFor(() => expect(recordCompletion).toHaveBeenCalledTimes(1));
    await settle();
    expect(recordCompletion).toHaveBeenCalledTimes(1);
    expect(recordCompletion.mock.calls[0]![0].durationMs).toBeUndefined();
    expect(peekGuidePercentage(content.url)).toBe(100);
  });

  it('records nothing when the persisted percentage already read 100%, even with an empty local emitted guard', async () => {
    const content = finishedGuide('bundled:opens-at-100');
    await seedFinishedLastStep(content.url, 100);
    render(<ContentRenderer content={content} completion={trackedCompletion(content)} />);

    await settle();
    expect(peekGuidePercentage(content.url)).toBe(100);
    expect(recordCompletion).not.toHaveBeenCalled();
  });

  it('records nothing for a docs page already marked complete', async () => {
    const content = makeDocsPage();
    await guideCompletionMarkStorage.set(URL, true);
    render(<ContentRenderer content={content} completion={trackedCompletion(content)} />);

    await settle();
    expect(recordCompletion).not.toHaveBeenCalled();
  });
});
