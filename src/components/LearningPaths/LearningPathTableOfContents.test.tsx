/**
 * Tests for the cover-page table of contents: it lists journey milestones and
 * marks per-milestone completion resolved from storage (issue #1467).
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { LearningPathTableOfContents } from './LearningPathTableOfContents';
import { milestoneCompletionStorage } from '../../lib/user-storage';
import type { Milestone } from '../../types/content.types';

jest.mock('@grafana/ui', () => ({
  useStyles2: () => new Proxy({}, { get: (_t, p) => String(p) }),
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string) => fallback,
}));

jest.mock('../../lib/user-storage', () => ({
  milestoneCompletionStorage: { getCompleted: jest.fn() },
}));

// The real docs-retrieval barrel drags content-fetcher (→ @grafana/runtime) at
// import time; the slug rule under test is a stable one-liner.
jest.mock('../../docs-retrieval', () => ({
  getMilestoneSlug: (url: string) =>
    url
      .replace(/\/(content\.json|unstyled\.html)$/, '')
      .replace(/\/+$/, '')
      .split('/')
      .pop() || '',
}));

const getCompletedMock = milestoneCompletionStorage.getCompleted as jest.MockedFunction<
  typeof milestoneCompletionStorage.getCompleted
>;

const baseUrl = 'https://grafana.com/docs/learning-paths/demo/';
const milestones: Milestone[] = [
  { number: 1, title: 'Set up', duration: '', url: `${baseUrl}set-up/content.json`, isActive: false },
  { number: 2, title: 'Explore', duration: '', url: `${baseUrl}explore/content.json`, isActive: false },
];

describe('LearningPathTableOfContents', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders every milestone title with a heading', async () => {
    getCompletedMock.mockResolvedValue(new Set());
    render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} />);

    expect(screen.getByText('In this path')).toBeInTheDocument();
    expect(screen.getByText('Set up')).toBeInTheDocument();
    expect(screen.getByText('Explore')).toBeInTheDocument();
    await waitFor(() => expect(getCompletedMock).toHaveBeenCalledWith(baseUrl));
  });

  it('shows a check for milestones whose slug is in the completed set', async () => {
    getCompletedMock.mockResolvedValue(new Set(['set-up']));
    render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} />);

    await waitFor(() => expect(document.querySelectorAll('[data-icon="check"]')).toHaveLength(1));
    expect(document.querySelectorAll('[data-icon="circle"]')).toHaveLength(1);
  });
});
