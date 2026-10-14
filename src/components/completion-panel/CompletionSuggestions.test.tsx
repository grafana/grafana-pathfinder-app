import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { RawContent } from '../../types/content.types';
import type { AnalyticsCompletionIdentity } from '../../docs-retrieval';
import type { DependencyList } from '../../types/package.types';
import type { CatalogPackage } from '../../types/package-catalog.types';
import { CompletionSuggestions } from './CompletionSuggestions';

const current: CatalogPackage = {
  key: 'bundled:first-dashboard',
  id: 'first-dashboard',
  url: 'bundled:first-dashboard',
  title: 'First dashboard',
  category: 'dashboards',
  format: 'guide',
  source: 'grafana',
};
const candidate: CatalogPackage = {
  ...current,
  key: 'bundled:next',
  id: 'next',
  url: 'bundled:next',
  title: 'Next dashboard',
};
const later: CatalogPackage = {
  ...candidate,
  key: 'bundled:later',
  id: 'later',
  url: 'bundled:later',
  title: 'A later dashboard',
};
let items = [current, candidate];
let loading = false;
let progress = new Map<string, { percent: number }>();
let scope = 'org:1';
const useRecommendations = jest.fn((content: RawContent, identity?: AnalyticsCompletionIdentity, inPath = false) => {
  const source = identity?.sourceConfirmed
    ? identity.guideSource === 'app-platform'
      ? 'organization'
      : 'grafana'
    : undefined;
  return {
    items,
    scope,
    loading,
    context: {
      url: content.url,
      id: identity?.guideId,
      public: source === 'grafana',
      source,
      inPath,
      recommends: content.metadata.packageManifest?.recommends as DependencyList | undefined,
      suggests: content.metadata.packageManifest?.suggests as DependencyList | undefined,
    },
  };
});
const launch = jest.fn();
jest.mock('../../learning-paths', () => ({ useCatalogProgress: () => progress }));
jest.mock('./useCompletionRecommendations', () => ({
  useCompletionRecommendations: (...args: Parameters<typeof useRecommendations>) => useRecommendations(...args),
}));
jest.mock('../LearningPaths/useCatalogLaunch', () => ({
  useCatalogLaunch: () => ({ launch, launchingKey: null, launchError: null }),
}));
jest.mock('../LearningContentCard/LearningContentCard', () => ({
  LearningContentCard: ({
    title,
    eyebrow,
    progress,
    onLaunch,
  }: {
    title: string;
    eyebrow?: string;
    progress?: number;
    onLaunch: () => void;
  }) => (
    <div>
      <span>{eyebrow}</span>
      <button onClick={onLaunch} data-progress={progress}>
        {title}
      </button>
    </div>
  ),
}));
const content: RawContent = {
  content: '{}',
  metadata: { title: 'First dashboard' },
  url: current.url,
  type: 'interactive',
  lastFetched: '',
};
const identity = { guideSource: 'bundled', guideId: current.id, sourceConfirmed: true };
beforeEach(() => {
  jest.clearAllMocks();
  items = [current, candidate];
  loading = false;
  scope = 'org:1';
  progress = new Map(items.map((item) => [item.key, { percent: 0 }]));
});

it('shows neutral fallback for private or unresolved identities without authored relationships', () => {
  const { rerender } = render(
    <CompletionSuggestions content={content} completionIdentity={{ ...identity, guideSource: 'app-platform' }} />
  );
  expect(screen.queryByRole('button', { name: candidate.title })).not.toBeInTheDocument();
  expect(screen.getByText('Find your next thing to learn.')).toBeInTheDocument();
  rerender(<CompletionSuggestions content={content} completionIdentity={{ ...identity, sourceConfirmed: false }} />);
  expect(screen.queryByRole('button', { name: candidate.title })).not.toBeInTheDocument();
});

it('waits for hydration so already completed guides never flash as suggestions', () => {
  progress = new Map();
  const { rerender } = render(<CompletionSuggestions content={content} completionIdentity={identity} />);
  expect(screen.getByRole('status')).toHaveTextContent('Finding your next step');
  expect(screen.queryByText(candidate.title)).not.toBeInTheDocument();
  progress = new Map([
    [current.key, { percent: 100 }],
    [candidate.key, { percent: 100 }],
  ]);
  rerender(<CompletionSuggestions content={content} completionIdentity={identity} />);
  expect(screen.getByText('Find your next thing to learn.')).toBeInTheDocument();
});

it('keeps a ready shortlist stable and launches using the existing helper', () => {
  const { rerender } = render(<CompletionSuggestions content={content} completionIdentity={identity} />);
  fireEvent.click(screen.getByRole('button', { name: candidate.title }));
  expect(launch).toHaveBeenCalledWith(candidate);
  items = [...items, later];
  progress = new Map(items.map((item) => [item.key, { percent: 0 }]));
  rerender(<CompletionSuggestions content={content} completionIdentity={identity} />);
  expect(screen.getByRole('button', { name: candidate.title })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: later.title })).not.toBeInTheDocument();
});

it('honors authored recommendation order and makes that provenance visible', () => {
  items = [current, candidate, later];
  progress = new Map(items.map((item) => [item.key, { percent: 0 }]));
  render(
    <CompletionSuggestions
      content={{
        ...content,
        metadata: { ...content.metadata, packageManifest: { recommends: [later.id], suggests: [candidate.id] } },
      }}
      completionIdentity={identity}
    />
  );
  const buttons = screen.getAllByRole('button');
  expect(buttons[0]).toHaveTextContent(later.title);
  expect(buttons[1]).toHaveTextContent(candidate.title);
  expect(screen.getByText('Recommended learning')).toBeInTheDocument();
  expect(screen.getByText('Related learning')).toBeInTheDocument();
});

it('permits confirmed private authored relationships without mixing public candidates', () => {
  const privateCandidate = { ...candidate, key: 'organization:next', source: 'organization' as const };
  items = [current, candidate, privateCandidate];
  progress = new Map(items.map((item) => [item.key, { percent: 0 }]));
  render(
    <CompletionSuggestions
      content={{
        ...content,
        metadata: { ...content.metadata, packageManifest: { recommends: [privateCandidate.id] } },
      }}
      completionIdentity={{ ...identity, guideSource: 'app-platform' }}
    />
  );
  expect(screen.getByText('Recommended learning')).toBeInTheDocument();
  const buttons = screen.getAllByRole('button', { name: candidate.title });
  expect(buttons).toHaveLength(1);
  fireEvent.click(buttons[0]!);
  expect(launch).toHaveBeenCalledWith(privateCandidate);
});

it('clears the old shortlist during a scoped refresh and waits for new progress', () => {
  const { rerender } = render(<CompletionSuggestions content={content} completionIdentity={identity} />);
  expect(screen.getByRole('button', { name: candidate.title })).toBeInTheDocument();
  scope = 'org:2';
  loading = true;
  progress = new Map();
  items = [current, later];
  rerender(<CompletionSuggestions content={content} completionIdentity={identity} />);
  expect(screen.queryByRole('button', { name: candidate.title })).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toBeInTheDocument();
  loading = false;
  progress = new Map(items.map((item) => [item.key, { percent: 0 }]));
  rerender(<CompletionSuggestions content={content} completionIdentity={identity} />);
  expect(screen.getByRole('button', { name: later.title })).toBeInTheDocument();
});

it('ignores legacy private completion percentages for both guide and path suggestions', () => {
  const privateGuide = { ...candidate, key: 'organization:next', source: 'organization' as const };
  const privatePath = { ...later, key: 'organization:later', source: 'organization' as const, format: 'path' as const };
  items = [privateGuide, privatePath];
  progress = new Map(items.map((item) => [item.key, { percent: 100 }]));
  render(
    <CompletionSuggestions
      content={{
        ...content,
        metadata: { ...content.metadata, packageManifest: { recommends: [privateGuide.id, privatePath.id] } },
      }}
      completionIdentity={{ ...identity, guideSource: 'app-platform' }}
    />
  );
  expect(screen.getByRole('button', { name: privateGuide.title })).toHaveAttribute('data-progress', '0');
  expect(screen.getByRole('button', { name: privatePath.title })).toHaveAttribute('data-progress', '0');
});

it('waits for matching progress keys even when a stale snapshot has the same size', () => {
  progress = new Map([
    ['old:first', { percent: 0 }],
    ['old:second', { percent: 0 }],
  ]);
  const { rerender } = render(<CompletionSuggestions content={content} completionIdentity={identity} />);
  expect(screen.getByRole('status')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: candidate.title })).not.toBeInTheDocument();
  progress = new Map(items.map((item) => [item.key, { percent: 0 }]));
  rerender(<CompletionSuggestions content={content} completionIdentity={identity} />);
  expect(screen.getByRole('button', { name: candidate.title })).toBeInTheDocument();
});
