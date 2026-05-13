/**
 * Tests for PanelModeActionButtons — the Pop out / Full screen pair extracted
 * from the two near-identical inline blocks in `docs-panel.tsx`. These tests
 * pin down the event contract (the buttons fire `pathfinder-request-pop-out`
 * and `pathfinder-request-full-screen`) and the test-id stability required
 * by Playwright.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { PanelModeActionButtons } from './PanelModeActionButtons';
import { testIds } from '../../../constants/testIds';

jest.mock('@grafana/ui', () => {
  const Real = jest.requireActual('react');
  return {
    Icon: ({ name }: { name: string }) => Real.createElement('span', { 'data-icon': name }, name),
  };
});

describe('PanelModeActionButtons', () => {
  it('renders both buttons with their stable test ids', () => {
    render(<PanelModeActionButtons className="ignored" />);

    expect(screen.getByTestId(testIds.docsPanel.popOutButton)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.docsPanel.fullScreenButton)).toBeInTheDocument();
  });

  it('dispatches `pathfinder-request-pop-out` on Pop out click', () => {
    const handler = jest.fn();
    document.addEventListener('pathfinder-request-pop-out', handler);
    try {
      render(<PanelModeActionButtons className="ignored" />);
      fireEvent.click(screen.getByTestId(testIds.docsPanel.popOutButton));
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('pathfinder-request-pop-out', handler);
    }
  });

  it('dispatches `pathfinder-request-full-screen` on Full screen click', () => {
    const handler = jest.fn();
    document.addEventListener('pathfinder-request-full-screen', handler);
    try {
      render(<PanelModeActionButtons className="ignored" />);
      fireEvent.click(screen.getByTestId(testIds.docsPanel.fullScreenButton));
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('pathfinder-request-full-screen', handler);
    }
  });

  it('applies the supplied className to both buttons (so each surface inherits its own action-button style)', () => {
    render(<PanelModeActionButtons className="my-secondary-style" />);

    expect(screen.getByTestId(testIds.docsPanel.popOutButton)).toHaveClass('my-secondary-style');
    expect(screen.getByTestId(testIds.docsPanel.fullScreenButton)).toHaveClass('my-secondary-style');
  });

  it('exposes accessible names suitable for screen readers', () => {
    render(<PanelModeActionButtons className="ignored" />);

    expect(screen.getByRole('button', { name: 'Pop out to floating panel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open in full screen' })).toBeInTheDocument();
  });
});
