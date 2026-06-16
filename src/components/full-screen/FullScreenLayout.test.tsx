/**
 * Tests for FullScreenLayout — the presentation shell wrapping FullScreenPanel.
 *
 * The layout is intentionally dumb: it renders title, step counter, and a row
 * of action buttons whose visibility is driven by props. These tests exercise
 * that visibility matrix and the click handlers — the deeper integration with
 * CombinedLearningJourneyPanel lives in E2E.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { FullScreenLayout } from './FullScreenLayout';
import { testIds } from '../../constants/testIds';

const mockTheme = {
  isDark: false,
  spacing: (...args: number[]) => args.map((n) => `${n * 8}px`).join(' '),
  shape: { radius: { default: '4px', pill: '9999px' } },
  shadows: { z1: '0 1px 2px rgba(0,0,0,0.1)' },
  // The sticky-top-bar style references `theme.zIndex.navbarFixed` so the
  // dock-back chrome floats above scrolling content. The mock only needs
  // a numeric stand-in.
  zIndex: { navbarFixed: 1000 },
  colors: {
    text: { primary: '#000', secondary: '#666', disabled: '#aaa' },
    background: { primary: '#fff', secondary: '#f5f5f5', canvas: '#fafafa' },
    border: { weak: '#ddd', medium: '#bbb', strong: '#888' },
    action: { hover: '#eee', disabledBackground: '#ccc', disabledText: '#999' },
  },
  typography: {
    h5: { fontSize: '16px' },
    body: { fontSize: '14px' },
    bodySmall: { fontSize: '12px' },
    fontWeightMedium: 500,
  },
};

jest.mock('@grafana/ui', () => {
  const Real = jest.requireActual('react');
  return {
    Button: ({ children, onClick, ...rest }: any) => Real.createElement('button', { onClick, ...rest }, children),
    IconButton: ({ name, onClick, tooltip, ...rest }: any) =>
      Real.createElement('button', { onClick, 'aria-label': rest['aria-label'] || tooltip, ...rest }, name),
    useStyles2: (fn: any) => fn(mockTheme),
  };
});

jest.mock('../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: { FullScreenCopyLink: 'full_screen_copy_link' },
}));

describe('FullScreenLayout', () => {
  it('renders the title and back-to-sidebar button', () => {
    const onExit = jest.fn();
    render(
      <FullScreenLayout title="My guide" hasActiveGuide={true} onExit={onExit}>
        <div>body</div>
      </FullScreenLayout>
    );

    expect(screen.getByText('My guide')).toBeInTheDocument();
    expect(screen.getByTestId(testIds.fullScreenMode.exitButton)).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('calls onExit when back-to-sidebar is clicked', () => {
    const onExit = jest.fn();
    render(
      <FullScreenLayout title="My guide" hasActiveGuide={true} onExit={onExit}>
        <div>body</div>
      </FullScreenLayout>
    );

    fireEvent.click(screen.getByTestId(testIds.fullScreenMode.exitButton));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('shows the step counter as an explicit "Step X of Y" label when stepProgress is provided', () => {
    render(
      <FullScreenLayout title="My guide" hasActiveGuide={true} stepProgress="3/7" onExit={() => {}}>
        <div />
      </FullScreenLayout>
    );

    expect(screen.getByText('Step 3 of 7')).toBeInTheDocument();
  });

  it('omits the step counter when stepProgress is undefined', () => {
    render(
      <FullScreenLayout title="My guide" hasActiveGuide={true} onExit={() => {}}>
        <div />
      </FullScreenLayout>
    );

    expect(screen.queryByText(/^Step \d+ of \d+$/)).not.toBeInTheDocument();
  });

  it('hides the copy-link button when guideUrl is missing', () => {
    render(
      <FullScreenLayout title="Editor" hasActiveGuide={false} onExit={() => {}}>
        <div />
      </FullScreenLayout>
    );

    expect(screen.queryByTestId(testIds.fullScreenMode.copyLinkButton)).not.toBeInTheDocument();
  });

  it('shows the copy-link button when both guideUrl and hasActiveGuide are set', () => {
    render(
      <FullScreenLayout title="My guide" hasActiveGuide={true} guideUrl="bundled:foo" onExit={() => {}}>
        <div />
      </FullScreenLayout>
    );

    expect(screen.getByTestId(testIds.fullScreenMode.copyLinkButton)).toBeInTheDocument();
  });

  it('uses the reworded "Copy link to this guide" tooltip and aria-label (no internal "workshop" jargon)', () => {
    render(
      <FullScreenLayout title="My guide" hasActiveGuide={true} guideUrl="bundled:foo" onExit={() => {}}>
        <div />
      </FullScreenLayout>
    );

    const button = screen.getByTestId(testIds.fullScreenMode.copyLinkButton);
    expect(button.getAttribute('aria-label')).toBe('Copy link to this guide');
    expect(button.getAttribute('aria-label')).not.toMatch(/workshop/i);
  });

  it('hides the go-floating button when no handler is provided', () => {
    render(
      <FullScreenLayout title="Editor" hasActiveGuide={true} onExit={() => {}}>
        <div />
      </FullScreenLayout>
    );

    expect(screen.queryByTestId(testIds.fullScreenMode.goFloatingButton)).not.toBeInTheDocument();
  });

  it('shows and dispatches the go-floating button when a handler is provided', () => {
    const onGoFloating = jest.fn();
    render(
      <FullScreenLayout
        title="My guide"
        hasActiveGuide={true}
        guideUrl="bundled:foo"
        onExit={() => {}}
        onGoFloating={onGoFloating}
      >
        <div />
      </FullScreenLayout>
    );

    const button = screen.getByTestId(testIds.fullScreenMode.goFloatingButton);
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(onGoFloating).toHaveBeenCalledTimes(1);
  });

  it('attaches the data-pathfinder-content attribute so the interactive engine can scope DOM queries', () => {
    render(
      <FullScreenLayout title="My guide" hasActiveGuide={true} onExit={() => {}}>
        <div />
      </FullScreenLayout>
    );

    const container = screen.getByTestId(testIds.fullScreenMode.container);
    expect(container.getAttribute('data-pathfinder-content')).toBe('true');
  });

  it('renders the subHeader slot when provided (used by the journey toolbar)', () => {
    render(
      <FullScreenLayout
        title="My journey"
        hasActiveGuide={true}
        onExit={() => {}}
        subHeader={<div data-testid="custom-sub-header">milestone 2 of 4</div>}
      >
        <div data-testid="body">body</div>
      </FullScreenLayout>
    );

    expect(screen.getByTestId('custom-sub-header')).toBeInTheDocument();
    expect(screen.getByText('milestone 2 of 4')).toBeInTheDocument();
  });

  it('omits any sub-header row when subHeader is not provided', () => {
    render(
      <FullScreenLayout title="My docs" hasActiveGuide={true} onExit={() => {}}>
        <div data-testid="body">body</div>
      </FullScreenLayout>
    );

    expect(screen.queryByTestId('custom-sub-header')).not.toBeInTheDocument();
  });

  describe('read-only mode', () => {
    it('hides the back-to-sidebar and copy-link chrome but keeps the title and step counter', () => {
      render(
        <FullScreenLayout
          title="My guide"
          hasActiveGuide={true}
          guideUrl="backend-guide:my-guide"
          stepProgress="2/5"
          readonly={true}
          onExit={() => {}}
        >
          <div>body</div>
        </FullScreenLayout>
      );

      expect(screen.queryByTestId(testIds.fullScreenMode.exitButton)).not.toBeInTheDocument();
      expect(screen.queryByTestId(testIds.fullScreenMode.copyLinkButton)).not.toBeInTheDocument();
      expect(screen.getByText('My guide')).toBeInTheDocument();
      expect(screen.getByText('Step 2 of 5')).toBeInTheDocument();
    });
  });
});
