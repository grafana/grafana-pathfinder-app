import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { RawContent } from '../../types/content.types';
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
const useCatalog = jest.fn(() => ({ items, scope: 'org:1', loading }));
const launch = jest.fn();
jest.mock('../../learning-paths', () => ({
  usePackageCatalog: () => useCatalog(),
  useCatalogProgress: () => progress,
}));
jest.mock('../LearningPaths/useCatalogLaunch', () => ({
  useCatalogLaunch: () => ({ launch, launchingKey: null, launchError: null }),
}));
jest.mock('../LearningContentCard/LearningContentCard', () => ({
  LearningContentCard: ({ title, onLaunch }: { title: string; onLaunch: () => void }) => (
    <button onClick={onLaunch}>{title}</button>
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
  progress = new Map(items.map((item) => [item.key, { percent: 0 }]));
});

it('does not load catalog suggestions for private or unresolved identities', () => {
  const { rerender } = render(
    <CompletionSuggestions content={content} completionIdentity={{ ...identity, guideSource: 'app-platform' }} />
  );
  expect(useCatalog).not.toHaveBeenCalled();
  expect(screen.getByText('Find your next thing to learn.')).toBeInTheDocument();
  rerender(<CompletionSuggestions content={content} completionIdentity={{ ...identity, sourceConfirmed: false }} />);
  expect(useCatalog).not.toHaveBeenCalled();
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
