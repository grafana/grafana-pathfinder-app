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

const guideUrl = 'https://example.com/sticky-guide';
const docsUrl = 'https://example.com/reference';

function publish(key: string) {
  publishGuideIndex({
    contentKey: key,
    index: computeGuideBlockIndex([
      { type: 'markdown', id: 'first' },
      { type: 'markdown', id: 'second' },
    ]),
    denominatorSource: 'live-pre-inlining',
  });
}

function surface(url: string, mode: 'floating' | 'fullscreen') {
  return (
    <FloatingPanelContent
      content={{ url, type: 'single-doc', metadata: { title: 'Guide' }, content: '', lastFetched: '' }}
      activeTab={{ id: 'floating-tab', currentUrl: url, baseUrl: url } as any}
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

it.each(['floating', 'fullscreen'] as const)('preserves the embedded %s milestone toolbar offset', async (mode) => {
  setActiveTabUrl(guideUrl);
  publish(guideUrl);
  render(React.cloneElement(surface(guideUrl, mode), { progressKey: guideUrl, onResetGuide: jest.fn() }));
  const progress = await screen.findByRole('progressbar');
  expect(progress.parentElement).toHaveStyle({ position: 'sticky', top: '-8px' });
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
