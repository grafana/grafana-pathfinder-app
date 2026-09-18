import React from 'react';
import { act, render, screen } from '@testing-library/react';

import { VmExpiryIndicator } from './VmExpiryIndicator';

describe('VmExpiryIndicator', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-14T11:30:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('counts down the server expiry and reports when the session expires', () => {
    render(<VmExpiryIndicator expiresAt="2026-09-14T11:31:01Z" className="expiry" />);

    expect(screen.getByTestId('coda-terminal-vm-expiry')).toHaveTextContent('2 min left');

    act(() => {
      jest.advanceTimersByTime(15_000);
    });
    expect(screen.getByTestId('coda-terminal-vm-expiry')).toHaveTextContent('1 min left');

    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(screen.getByTestId('coda-terminal-vm-expiry')).toHaveTextContent('Session expired');
  });

  it('hides an unknown zero-time expiry without starting a clock', () => {
    const { container } = render(<VmExpiryIndicator expiresAt="0001-01-01T00:00:00Z" className="expiry" />);

    expect(container).toBeEmptyDOMElement();
    expect(jest.getTimerCount()).toBe(0);
  });
});
