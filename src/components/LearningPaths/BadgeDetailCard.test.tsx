import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { getPathsData } from '../../learning-paths';
import type { EarnedBadge } from '../../types';
import { openGuideInSidebar } from '../docs-panel/utils/open-prepared-guide';
import { BadgeDetailCard } from './BadgeDetailCard';

jest.mock('../../learning-paths', () => ({ getPathsData: jest.fn() }));
jest.mock('../docs-panel/utils/open-prepared-guide', () => ({ openGuideInSidebar: jest.fn() }));

const badge: EarnedBadge = {
  id: 'penguin-wrangler',
  title: 'Penguin Wrangler',
  description: 'Complete the Linux path',
  icon: 'rocket',
  trigger: { type: 'path-completed', pathId: 'linux-server-integration' },
};

function setPath(url?: string) {
  jest.mocked(getPathsData).mockReturnValue({
    paths: [
      {
        id: 'linux-server-integration',
        title: 'Monitor a Linux server',
        description: '',
        guides: [],
        badgeId: badge.id,
        url,
      },
    ],
    guideMetadata: {},
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setPath('https://grafana.com/docs/learning-paths/linux-server-integration/');
});

it('opens the exact required path in Learn and closes the badge details', () => {
  const close = jest.fn();
  render(<BadgeDetailCard badge={badge} progress={null} onClose={close} />, { wrapper: MemoryRouter });

  const link = screen.getByRole('link', { name: 'Monitor a Linux server' });
  const destination = new URL(link.getAttribute('href')!, 'https://grafana.example');
  expect(destination.searchParams.get('doc')).toBe('https://grafana.com/docs/learning-paths/linux-server-integration/');
  expect(destination.searchParams.get('type')).toBe('learning-journey');
  expect(destination.searchParams.get('panelMode')).toBe('sidebar');

  fireEvent.click(link);
  expect(close).toHaveBeenCalledTimes(1);
  expect(openGuideInSidebar).toHaveBeenCalledWith({
    url: 'https://grafana.com/docs/learning-paths/linux-server-integration/',
    title: 'Monitor a Linux server',
    source: 'content_link',
  });
});

it.each([undefined, 'javascript:alert(1)', 'https://example.com/unrelated'])(
  'keeps the requirement readable without a link for an unavailable or disallowed destination (%s)',
  (url) => {
    setPath(url);
    render(<BadgeDetailCard badge={badge} progress={null} onClose={jest.fn()} />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Complete all guides in the "Monitor a Linux server" learning path')).toBeInTheDocument();
  }
);

it('keeps streak requirements unlinked and shows the labelled progress section after the requirement', () => {
  render(
    <BadgeDetailCard
      badge={{ ...badge, trigger: { type: 'streak', days: 3 } }}
      progress={{ current: 1, total: 3, label: 'day streak', percentage: 33 }}
      onClose={jest.fn()}
    />
  );

  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(screen.getByText('Maintain a 3-day learning streak')).toBeInTheDocument();
  expect(screen.getByText('1/3 day streak')).toBeInTheDocument();
  const requirement = screen.getByText('Requirement');
  const progressLabel = screen.getByText('Progress');
  const progressBar = screen.getByRole('progressbar');
  expect(requirement.compareDocumentPosition(progressLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(progressLabel.compareDocumentPosition(progressBar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(progressBar.compareDocumentPosition(screen.getByText('33%')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
