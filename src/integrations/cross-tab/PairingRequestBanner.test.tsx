import React from 'react';
import { act, render, fireEvent, screen } from '@testing-library/react';
import { PairingRequestBanner } from './PairingRequestBanner';
import { testIds } from '../../constants/testIds';

jest.mock('@grafana/ui', () => ({
  useStyles2: (fn: Function) => fn(THEME),
  Button: ({
    children,
    onClick,
    'data-testid': testId,
  }: {
    children: React.ReactNode;
    onClick: () => void;
    'data-testid'?: string;
  }) => (
    <button onClick={onClick} data-testid={testId}>
      {children}
    </button>
  ),
}));

jest.mock('@grafana/data', () => ({
  ThemeContext: {
    Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  },
}));

jest.mock('@grafana/runtime', () => ({
  config: {
    theme2: {
      colors: {
        background: { primary: '#fff' },
        border: { weak: '#ddd' },
        text: { primary: '#000', secondary: '#666' },
      },
      spacing: (n: number) => `${n * 8}px`,
      shape: { radius: { default: '4px' } },
      shadows: { z3: '0 4px 8px rgba(0,0,0,0.2)' },
      typography: {
        h5: { fontSize: '16px' },
        bodySmall: { fontSize: '12px' },
        fontWeightMedium: 500,
      },
    },
  },
}));

// Must be defined after jest.mock hoisting so the mock factory can reference it.
const THEME = {
  colors: {
    background: { primary: '#fff' },
    border: { weak: '#ddd' },
    text: { primary: '#000', secondary: '#666' },
  },
  spacing: (n: number) => `${n * 8}px`,
  shape: { radius: { default: '4px' } },
  shadows: { z3: '0 4px 8px rgba(0,0,0,0.2)' },
  typography: {
    h5: { fontSize: '16px' },
    bodySmall: { fontSize: '12px' },
    fontWeightMedium: 500,
  },
};

function firePairingRequest(senderId: string) {
  act(() => {
    window.dispatchEvent(new CustomEvent('pathfinder-pairing-request', { detail: { senderId } }));
  });
}

describe('PairingRequestBanner', () => {
  it('renders nothing by default', () => {
    render(<PairingRequestBanner />);
    expect(screen.queryByTestId(testIds.pairingBanner.banner)).not.toBeInTheDocument();
  });

  it('shows the banner after a pathfinder-pairing-request event', () => {
    render(<PairingRequestBanner />);
    firePairingRequest('ctrl-1');
    expect(screen.getByTestId(testIds.pairingBanner.banner)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.pairingBanner.acceptButton)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.pairingBanner.rejectButton)).toBeInTheDocument();
  });

  it('clicking Accept dispatches pathfinder-pairing-accepted with correct senderId and hides banner', () => {
    render(<PairingRequestBanner />);
    firePairingRequest('ctrl-2');

    const accepted: CustomEvent[] = [];
    const listener = (e: Event) => accepted.push(e as CustomEvent);
    window.addEventListener('pathfinder-pairing-accepted', listener);

    fireEvent.click(screen.getByTestId(testIds.pairingBanner.acceptButton));

    window.removeEventListener('pathfinder-pairing-accepted', listener);

    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.detail.senderId).toBe('ctrl-2');
    expect(screen.queryByTestId(testIds.pairingBanner.banner)).not.toBeInTheDocument();
  });

  it('clicking Reject dispatches pathfinder-pairing-rejected with correct senderId and hides banner', () => {
    render(<PairingRequestBanner />);
    firePairingRequest('ctrl-3');

    const rejected: CustomEvent[] = [];
    const listener = (e: Event) => rejected.push(e as CustomEvent);
    window.addEventListener('pathfinder-pairing-rejected', listener);

    fireEvent.click(screen.getByTestId(testIds.pairingBanner.rejectButton));

    window.removeEventListener('pathfinder-pairing-rejected', listener);

    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.detail.senderId).toBe('ctrl-3');
    expect(screen.queryByTestId(testIds.pairingBanner.banner)).not.toBeInTheDocument();
  });

  it('a second pairing request replaces the first (no stacking)', () => {
    render(<PairingRequestBanner />);
    firePairingRequest('ctrl-A');
    firePairingRequest('ctrl-B');

    const banners = screen.getAllByTestId(testIds.pairingBanner.banner);
    expect(banners).toHaveLength(1);

    const accepted: CustomEvent[] = [];
    const listener = (e: Event) => accepted.push(e as CustomEvent);
    window.addEventListener('pathfinder-pairing-accepted', listener);

    fireEvent.click(screen.getByTestId(testIds.pairingBanner.acceptButton));

    window.removeEventListener('pathfinder-pairing-accepted', listener);

    expect(accepted[0]!.detail.senderId).toBe('ctrl-B');
  });
});
