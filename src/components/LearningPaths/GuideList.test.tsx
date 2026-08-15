import React from 'react';
import { render, screen } from '@testing-library/react';
import { GuideList } from './GuideList';
import type { PathGuide } from '../../types/learning-paths.types';

jest.mock('@grafana/ui', () => ({
  useStyles2: () => new Proxy({}, { get: (_t, p) => String(p) }),
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    vars ? fallback.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k])) : fallback,
}));

const guides: PathGuide[] = [
  { id: 'a', title: 'First module', completed: true, isCurrent: false },
  { id: 'b', title: 'Second module', completed: false, isCurrent: true },
  { id: 'c', title: 'Third module', completed: false, isCurrent: false },
  { id: 'd', title: 'Fourth module', completed: false, isCurrent: false, locked: true },
];

describe('GuideList', () => {
  it('renders a row per guide: check when completed, play when current, circle when pending, lock when locked', () => {
    render(<GuideList guides={guides} />);

    expect(screen.getByText('First module')).toBeInTheDocument();
    expect(screen.getByText('Second module')).toBeInTheDocument();
    expect(screen.getByText('Third module')).toBeInTheDocument();
    expect(screen.getByText('Fourth module')).toBeInTheDocument();

    expect(document.querySelectorAll('[data-icon="check"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-icon="play"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-icon="circle"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-icon="lock"]')).toHaveLength(1);
    expect(screen.getByText('Locked')).toBeInTheDocument();
  });

  it('marks only the current row as a journey-start target, when it has a url', () => {
    const withUrl: PathGuide[] = [
      { id: 'a', title: 'Current module', completed: false, isCurrent: true, url: 'bundled:a/content.json' },
      { id: 'b', title: 'Other module', completed: false, isCurrent: false, url: 'bundled:b/content.json' },
    ];
    render(<GuideList guides={withUrl} />);

    const currentRow = screen.getByText('Current module').closest('div[data-journey-start]');
    expect(currentRow).toHaveAttribute('data-milestone-url', 'bundled:a/content.json');
    expect(screen.getByText('Other module').closest('div')).not.toHaveAttribute('data-journey-start');
  });

  it('shows the estimated minutes tag when present and not locked', () => {
    const timed: PathGuide[] = [
      { id: 'a', title: 'Timed module', completed: false, isCurrent: false, estimatedMinutes: 12 },
    ];
    render(<GuideList guides={timed} />);

    expect(screen.getByText('12 min')).toBeInTheDocument();
  });

  it('shows a loading row instead of the list when isLoading is set', () => {
    render(<GuideList guides={[]} isLoading />);

    expect(screen.getByText('Loading guides...')).toBeInTheDocument();
    expect(document.querySelector('[data-icon="fa fa-spinner"]')).toBeInTheDocument();
  });

  it("renders a guide's description when present, and omits it when absent", () => {
    const withDescription: PathGuide[] = [
      {
        id: 'a',
        title: 'First module',
        description: 'What data sources are and why they matter.',
        completed: false,
        isCurrent: true,
      },
      { id: 'b', title: 'Second module', completed: false, isCurrent: false },
    ];
    render(<GuideList guides={withDescription} />);

    expect(screen.getByText('What data sources are and why they matter.')).toBeInTheDocument();
    expect(screen.getByText('Second module').closest('div')).not.toHaveTextContent('undefined');
  });
});
