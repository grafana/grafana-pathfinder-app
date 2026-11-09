import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { of } from 'rxjs';
import type { CatalogPackage } from '../../types/package-catalog.types';
import type { RawContent } from '../../types/content.types';
import { CompletionSuggestions } from './CompletionSuggestions';

const mockFetch = jest.fn();
const mockLaunch = jest.fn();
jest.mock('../../utils/openfeature', () => ({ useBooleanFlag: () => true }));
jest.mock('@grafana/runtime', () => ({
  config: {
    namespace: 'org-a',
    bootData: { user: { id: 1, orgId: 1 } },
    featureToggles: { 'aggregation.pathfinderbackend-ext-grafana-app.enabled': true },
  },
  getBackendSrv: () => ({ fetch: mockFetch }),
}));
jest.mock('../../package-engine', () => ({
  AppPlatformPackageResolver: jest.requireActual('../../package-engine/app-platform-resolver')
    .AppPlatformPackageResolver,
}));
jest.mock('../../learning-paths', () => ({
  usePackageCatalog: () => ({ items: [], scope: 'org-a:1:1', loading: false }),
  useCatalogProgress: (items: CatalogPackage[]) => new Map(items.map((item) => [item.key, { percent: 0 }])),
}));
jest.mock('../LearningPaths/useCatalogLaunch', () => ({
  useCatalogLaunch: () => ({ launch: mockLaunch, launchingKey: null, launchError: null }),
}));
jest.mock('../docs-panel/utils/open-catalog-browser', () => ({
  openCatalogBrowser: jest.fn(),
  openLearningHome: jest.fn(),
}));
jest.mock('../LearningContentCard/LearningContentCard', () => ({
  LearningContentCard: ({ title, onLaunch }: { title: string; onLaunch: () => void }) => (
    <button onClick={onLaunch}>{title}</button>
  ),
}));

beforeEach(() => jest.clearAllMocks());

it.each([
  ['inferred manifest', undefined],
  ['persisted manifest', { type: 'guide', description: 'Authored summary' }],
])('shows organization-authored recommendations from real resolver metadata with an %s', async (_label, manifest) => {
  mockFetch.mockReturnValue(
    of({
      data: {
        metadata: { name: 'next' },
        spec: {
          id: 'next',
          title: 'Organization next steps',
          status: 'published',
          manifest,
          blocks: [{ type: 'markdown', content: 'Next steps' }],
        },
      },
    })
  );
  const content: RawContent = {
    url: 'backend-guide:current',
    type: 'interactive',
    content: '{}',
    lastFetched: '',
    metadata: {
      title: 'Current guide',
      packageManifest: { id: 'current', type: 'guide', suggests: ['next'] },
    },
  };
  render(
    <CompletionSuggestions
      content={content}
      completionIdentity={{ guideId: 'current', guideSource: 'app-platform', sourceConfirmed: true }}
    />
  );

  const recommendation = await screen.findByRole('button', { name: 'Organization next steps' });
  expect(screen.queryByText('Keep your learning going')).not.toBeInTheDocument();
  expect(mockFetch).toHaveBeenCalledTimes(1);
  fireEvent.click(recommendation);
  expect(mockLaunch).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'next',
      title: 'Organization next steps',
      source: 'organization',
      url: 'backend-guide:next',
      description: manifest?.description ?? 'Organization next steps',
    })
  );
});
