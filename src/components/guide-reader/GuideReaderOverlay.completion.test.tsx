import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GuideReaderOverlay } from './GuideReaderOverlay';
import { fetchUnifiedContent, recordGuideCompletionForSurface } from '../../docs-retrieval';
import { resetContentKeyForTests } from '../../global-state/content-key';
import { prepareGuideLaunch } from '../docs-panel/utils/prepare-guide-launch';
import { openGuideInSidebar } from '../docs-panel/utils/open-prepared-guide';
import { testIds } from '../../constants/testIds';

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values?.[key] ?? '')),
}));
jest.mock('../../utils/openfeature', () => ({
  useBooleanFlag: () => true,
  getFeatureFlagValue: () => true,
}));
jest.mock('../OpenFeatureProvider', () => ({
  PathfinderFeatureProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('../../docs-retrieval', () => ({
  ...jest.requireActual('../../docs-retrieval'),
  fetchUnifiedContent: jest.fn(),
  recordGuideCompletionForSurface: jest.fn(),
}));
jest.mock('../docs-panel/utils/prepare-guide-launch', () => ({ prepareGuideLaunch: jest.fn() }));
jest.mock('../docs-panel/utils/open-prepared-guide', () => ({ openGuideInSidebar: jest.fn() }));
jest.mock('../../learning-paths', () => ({
  ...jest.requireActual('../../learning-paths'),
  useCatalogProgress: () => new Map([['bundled:next', { percent: 0 }]]),
}));
jest.mock('../completion-panel/useCompletionRecommendations', () => ({
  useCompletionRecommendations: () => ({
    scope: 'test:1',
    loading: false,
    context: { url: 'bundled:current', public: true, source: 'grafana', recommends: ['next'] },
    items: [
      {
        key: 'bundled:next',
        id: 'next',
        url: 'bundled:next',
        title: 'Next guide',
        category: 'dashboards',
        format: 'guide',
        source: 'grafana',
      },
    ],
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  resetContentKeyForTests();
  jest.mocked(fetchUnifiedContent).mockResolvedValue({
    content: {
      content: '<p>A guide to complete.</p>',
      type: 'single-doc',
      url: 'bundled:current',
      lastFetched: '',
      metadata: { title: 'Current guide' },
    },
  });
  jest.mocked(prepareGuideLaunch).mockResolvedValue({ ok: true, launch: { url: 'bundled:next' } } as any);
});

it('keeps completion in the controller reader without offering launches behind its opaque overlay', async () => {
  render(<GuideReaderOverlay doc="bundled:current" mode="controller" />);
  const complete = await screen.findByTestId(testIds.markComplete.button);
  await waitFor(() => expect(complete).toBeEnabled());
  fireEvent.click(complete);
  await waitFor(() => expect(recordGuideCompletionForSurface).toHaveBeenCalledTimes(1));
  await act(async () => {});

  const hiddenLaunch = screen.queryByRole('button', { name: 'Start Next guide' });
  if (hiddenLaunch) {
    await act(async () => {
      fireEvent.click(hiddenLaunch);
    });
    expect(openGuideInSidebar).toHaveBeenCalledWith({ url: 'bundled:next' });
    expect(screen.getByTestId(testIds.guideReader.overlay)).toBeInTheDocument();
  }
  expect(screen.queryByTestId('completion-panel')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^(Start|Resume|Explore)/ })).not.toBeInTheDocument();
  expect(screen.getByText('Completed')).toBeInTheDocument();
  expect(openGuideInSidebar).not.toHaveBeenCalled();
});
