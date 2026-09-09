/**
 * The Mark complete control is unconditional (COMPLETION-MODEL.md, decision 2).
 *
 * These cases assert PRESENCE across the shapes a predicate-based design would
 * have excluded — a prose-only guide, a guide that already ends on a completable
 * block, a milestone, a block-editor preview. There is deliberately no case
 * asserting absence for a guide shape; such a test would re-encode the
 * predicate the model deleted. The one absence covered is a path's cover page,
 * which is a table of contents rather than a guide.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

import type { RawContent } from '../../types/content.types';
import { testIds } from '../../constants/testIds';
import { dispatchProgress } from '../../global-state/progress-events';
import { ContentRenderer } from './content-renderer';

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string) => fallback,
}));

const baseUrl = 'https://grafana.com/docs/learning-paths/demo';
const milestones = [{ number: 1, title: 'Set up', duration: '', url: `${baseUrl}/set-up/`, isActive: false }];

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

function makeMilestone(currentMilestone = 1): RawContent {
  return makeContent({
    type: 'learning-journey',
    metadata: {
      title: 'Demo',
      learningJourney: { currentMilestone, totalMilestones: milestones.length, milestones, baseUrl },
    },
  });
}

describe('ContentRenderer — the universal Mark complete control', () => {
  it.each([
    ['a prose-only guide', makeContent()],
    ['a guide with interactive steps', makeContent({ content: WITH_INTERACTIVE_STEP })],
    ['a milestone', makeMilestone()],
    ['a block-editor preview', makeContent({ url: 'block-editor://preview/demo' })],
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

  it('records one completion when the click is followed by the automatic route', () => {
    jest.useFakeTimers();
    const onGuideComplete = jest.fn();
    const content = makeContent();
    window.__DocsPluginActiveTabUrl = content.url;
    render(<ContentRenderer content={content} onGuideComplete={onGuideComplete} />);

    // The renderer ignores progress events until content settles.
    act(() => {
      jest.advanceTimersByTime(300);
    });

    fireEvent.click(screen.getByTestId(testIds.markComplete.button));
    act(() => {
      dispatchProgress({ kind: 'guide', contentKey: content.url, percentage: 100, hasProgress: true });
    });

    expect(onGuideComplete).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});
