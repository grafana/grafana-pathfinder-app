import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { FloatingPanelContent } from './FloatingPanelContent';
import { MarkCompleteFooter } from '../mark-complete/MarkCompleteFooter';
import { setActiveTabUrl, resetContentKeyForTests } from '../../global-state/content-key';
import { publishGuideIndex } from '../../global-state/active-guide-index';
import { peekGuidePercentage, resetCompletionStoreForTests } from '../../global-state/completion-store';
import { computeGuideBlockIndex } from '../../lib/guide-stats';
import { interactiveStepStorage } from '../../lib/user-storage';
import type { RawContent } from '../../types/content.types';

jest.mock('@grafana/runtime', () => ({
  usePluginUserStorage: jest.fn(),
  getAppEvents: jest.fn(() => ({ publish: jest.fn() })),
}));
jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars?.[k] ?? '')),
}));
jest.mock('../../lib/analytics', () => ({
  ...jest.requireActual('../../lib/analytics'),
  reportAppInteraction: jest.fn(),
}));
jest.mock('../../utils/openfeature', () => ({ useBooleanFlag: () => true }));
jest.mock('../../docs-retrieval', () => ({
  resolveActiveMilestoneSequence: jest.requireActual('../../docs-retrieval/active-milestone-sequence')
    .resolveActiveMilestoneSequence,
  resolveActiveMilestoneToolbarContext: jest.requireActual('../../docs-retrieval/active-milestone-sequence')
    .resolveActiveMilestoneToolbarContext,
  useGuideResponsesOptional: () => null,
  isJourneyCoverPage: (content: RawContent) =>
    content.type === 'learning-journey' && content.metadata.learningJourney?.currentMilestone === 0,
}));
jest.mock('../docs-panel/link-handler.hook', () => ({ useLinkClickHandler: jest.fn() }));
jest.mock('../docs-panel/components', () => ({
  AlignmentPrompt: () => null,
  GuideVersionNotice: () => null,
  LearningJourneyMilestoneToolbar: () => null,
}));
jest.mock('../InteractiveLearningBanner', () => ({ InteractiveLearningBanner: () => null }));
jest.mock('../content-renderer/content-renderer', () => ({
  ContentRenderer: ({ content }: { content: RawContent }) => {
    React.useLayoutEffect(() => {
      window.__DocsPluginContentKey = content.url;
    }, [content.url]);
    return <MarkCompleteFooter context="guide" contentUrl={content.url} />;
  },
}));

jest.mock('../../hooks/usePathfinderPluginConfig', () => ({
  usePathfinderPluginConfig: () => ({ config: {} }),
}));

const originalResizeObserver = global.ResizeObserver;
beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterAll(() => {
  global.ResizeObserver = originalResizeObserver;
});

const guideUrl = 'https://example.com/sticky-guide';
const docsUrl = 'https://example.com/reference';

function publish(key: string) {
  publishGuideIndex({
    contentKey: key,
    index: computeGuideBlockIndex([
      { type: 'quiz', id: 'first' },
      { type: 'quiz', id: 'second' },
    ]),
    denominatorSource: 'live-pre-inlining',
  });
}

function surface(url: string, mode: 'floating' | 'fullscreen') {
  return (
    <FloatingPanelContent
      content={{ url, type: 'single-doc', metadata: { title: 'Guide' }, content: '', lastFetched: '' }}
      activeTab={{ id: 'floating-tab', title: 'Guide', type: 'docs', currentUrl: url, baseUrl: url } as any}
      model={{ canNavigateNext: () => false } as any}
      surface={mode}
    />
  );
}

beforeEach(async () => {
  await interactiveStepStorage.clearAll();
  localStorage.clear();
  resetCompletionStoreForTests();
  resetContentKeyForTests();
  window.__DocsPluginActiveTabUrl = '';
  window.__DocsPluginContentKey = '';
});

it.each(['floating', 'fullscreen'] as const)(
  'keeps standalone %s progress inside the scrollport when sticky',
  async (mode) => {
    setActiveTabUrl(guideUrl);
    publish(guideUrl);
    render(surface(guideUrl, mode));
    const progress = await screen.findByRole('progressbar');
    expect(progress.parentElement).toHaveStyle({ position: 'sticky', top: '0px' });
  }
);

it('keeps one sticky guide toolbar with matching step count and fill in the popout', async () => {
  setActiveTabUrl(guideUrl);
  publish(guideUrl);
  render(React.cloneElement(surface(guideUrl, 'floating'), { progressKey: guideUrl, onResetGuide: jest.fn() }));
  expect(screen.getByRole('heading', { name: 'Guide' })).toBeInTheDocument();
  const progress = await screen.findByRole('progressbar');
  expect(progress.parentElement?.parentElement).toHaveStyle({ position: 'sticky', top: '-8px' });

  act(() => {
    window.dispatchEvent(new CustomEvent('pathfinder-step-progress', { detail: { completedCount: 1, totalSteps: 5 } }));
  });
  expect(screen.getAllByRole('progressbar')).toHaveLength(1);
  expect(progress).toHaveAttribute('aria-valuetext', '1 of 5 steps completed');
  expect(progress.querySelector('[style*="width"]')).toHaveStyle({ width: '20%' });
});

it('hides guide progress when the full-screen header supplies path progress', async () => {
  setActiveTabUrl(guideUrl);
  publish(guideUrl);
  const guide = surface(guideUrl, 'fullscreen');
  const { rerender } = render(guide);
  expect(await screen.findByRole('progressbar')).toBeInTheDocument();

  rerender(React.cloneElement(guide, { showGuideProgress: false }));

  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});

it('hides guide progress when the floating toolbar supplies path progress', async () => {
  setActiveTabUrl(guideUrl);
  publish(guideUrl);
  const milestone = { number: 1, title: 'Lesson', url: guideUrl, isActive: true };
  const content: RawContent = {
    url: guideUrl,
    type: 'learning-journey',
    metadata: {
      title: 'Lesson',
      learningJourney: {
        baseUrl: 'backend-guide:path',
        currentMilestone: 1,
        totalMilestones: 1,
        milestones: [milestone],
      },
    },
    content: '',
    lastFetched: '',
  };
  const standalone = surface(guideUrl, 'floating');
  const view = render(standalone);
  expect(await screen.findByRole('progressbar')).toBeInTheDocument();

  view.rerender(
    React.cloneElement(standalone, {
      content,
      activeTab: { ...standalone.props.activeTab, type: 'learning-journey', content },
      progressKey: guideUrl,
      onResetGuide: jest.fn(),
    })
  );

  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});

it.each(['floating', 'fullscreen'] as const)(
  'updates %s progress after marking a partly completed guide',
  async (mode) => {
    setActiveTabUrl(guideUrl);
    publish(guideUrl);
    await interactiveStepStorage.setCompleted(guideUrl, 'standalone', new Set(['first']));
    expect(peekGuidePercentage(guideUrl)).toBe(50);
    render(surface(guideUrl, mode));
    await waitFor(() => expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50'));
    const button = await screen.findByTestId('mark-complete-button');
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(await screen.findByText('Completed')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100'));
  }
);

it.each(['floating', 'fullscreen'] as const)(
  'gates %s navigation using the post-layout key, including cached indexes',
  async (mode) => {
    window.__DocsPluginActiveTabUrl = guideUrl;
    publish(guideUrl);
    const view = render(surface(guideUrl, mode));
    await screen.findByRole('progressbar');
    view.rerender(surface(docsUrl, mode));
    await act(async () => {});
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    view.rerender(surface(guideUrl, mode));
    expect(await screen.findByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  }
);

it.each(['floating', 'fullscreen'] as const)(
  'shows %s progress when a cold index publishes without a parent render',
  async (mode) => {
    render(surface(guideUrl, mode));
    await act(async () => {});
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    act(() => publish(guideUrl));
    expect(await screen.findByRole('progressbar')).toBeInTheDocument();
  }
);
