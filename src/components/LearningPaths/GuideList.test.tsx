import React from 'react';
import { render, screen } from '@testing-library/react';
import { GuideList } from './GuideList';
import type { PathGuide } from '../../types/learning-paths.types';

jest.mock('@grafana/ui', () => ({
  useStyles2: () => new Proxy({}, { get: (_t, p) => String(p) }),
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string) => fallback,
}));

const guides: PathGuide[] = [
  { id: 'a', title: 'First module', completed: true, isCurrent: false },
  { id: 'b', title: 'Second module', completed: false, isCurrent: true },
  { id: 'c', title: 'Third module', completed: false, isCurrent: false },
];

describe('GuideList', () => {
  it('renders a row per guide with a check icon for completed and a circle otherwise', () => {
    render(<GuideList guides={guides} />);

    expect(screen.getByText('First module')).toBeInTheDocument();
    expect(screen.getByText('Second module')).toBeInTheDocument();
    expect(screen.getByText('Third module')).toBeInTheDocument();

    expect(document.querySelectorAll('[data-icon="check"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-icon="circle"]')).toHaveLength(2);
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
