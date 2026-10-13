import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FloatingPanel } from './FloatingPanel';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';

jest.mock('@grafana/ui', () => {
  const actual = jest.requireActual('@grafana/ui');
  const Real = jest.requireActual('react');
  return {
    ...actual,
    IconButton: ({ name, onClick, tooltip, ...rest }: any) =>
      Real.createElement('button', { type: 'button', onClick, title: tooltip, ...rest }, name),
  };
});

jest.mock('../../lib/analytics', () => ({
  ...jest.requireActual('../../lib/analytics'),
  reportAppInteraction: jest.fn(),
}));

const mockCopyTextToClipboard = jest.fn();
jest.mock('../../lib/clipboard', () => ({
  copyTextToClipboard: (text: string) => mockCopyTextToClipboard(text),
}));

describe('FloatingPanel copy-link button', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function clickCopyLink() {
    render(
      <FloatingPanel
        title="My guide"
        hasActiveGuide={true}
        guideUrl="bundled:foo"
        onSwitchToSidebar={() => {}}
        onClose={() => {}}
      >
        <div />
      </FloatingPanel>
    );
    const button = screen.getByLabelText('Copy workshop link');
    fireEvent.click(button);
    return button;
  }

  it('shows the copied state and reports the copy when it succeeds', async () => {
    mockCopyTextToClipboard.mockResolvedValue(true);

    const button = clickCopyLink();

    await waitFor(() => expect(button).toHaveAttribute('title', 'Copied!'));
    expect(button).toHaveTextContent('check');
    expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.FloatingPanelCopyLink, {
      guide_url: 'bundled:foo',
    });
  });

  it('shows the failed state and reports nothing when the copy fails', async () => {
    mockCopyTextToClipboard.mockResolvedValue(false);

    const button = clickCopyLink();

    await waitFor(() => expect(button).toHaveAttribute('title', 'Could not copy the link'));
    expect(button).toHaveTextContent('exclamation-triangle');
    expect(reportAppInteraction).not.toHaveBeenCalledWith(UserInteraction.FloatingPanelCopyLink, expect.anything());
  });
});
