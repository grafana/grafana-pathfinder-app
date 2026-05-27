/**
 * Smoke + branch tests for LiveSessionTopBar.
 *
 * The component returns null when both `isLiveSessionsEnabled` and
 * `isSessionActive` are off — the wrapping `<div className={styles.topBar}>`
 * is fully suppressed, preserving the surrounding layout for users without
 * live sessions enabled.
 */

import React, { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { LiveSessionTopBar } from './LiveSessionTopBar';

// Light mocks so JSDOM can mount the component.
jest.mock('@grafana/ui', () => {
  const Real = jest.requireActual('react');
  return {
    Alert: ({ children }: any) => Real.createElement('div', { role: 'alert' }, children),
    Button: ({ children, onClick, ...rest }: any) => Real.createElement('button', { onClick, ...rest }, children),
    ButtonGroup: ({ children }: any) => Real.createElement('div', null, children),
    Icon: ({ name }: any) => Real.createElement('span', { 'data-icon': name }, name),
  };
});

jest.mock('../../LiveSession', () => {
  const Real = jest.requireActual('react');
  return {
    HandRaiseButton: () => Real.createElement('button', { 'data-component': 'HandRaiseButton' }, 'Hand'),
    HandRaiseIndicator: ({ count }: any) =>
      Real.createElement('button', { 'data-component': 'HandRaiseIndicator' }, String(count)),
  };
});

const baseProps = {
  className: 'topBar',
  liveSessionButtonsClassName: 'liveSessionButtons',
  isLiveSessionsEnabled: false,
  isSessionActive: false,
  sessionRole: null,
  sessionInfo: null,
  sessionManager: null,
  handRaises: [],
  handRaiseIndicatorRef: createRef<HTMLDivElement | null>(),
  attendeeMode: null,
  setAttendeeMode: jest.fn(),
  actionReplayRef: createRef<{ setMode: (m: any) => void } | null>(),
  isHandRaised: false,
  onHandRaiseToggle: jest.fn(),
  onShowPresenterControls: jest.fn(),
  onShowAttendeeJoin: jest.fn(),
  onShowHandRaiseQueue: jest.fn(),
  endSession: jest.fn(),
  logSession: jest.fn(),
} as any;

describe('LiveSessionTopBar', () => {
  it('renders null when both flags are off', () => {
    const { container } = render(<LiveSessionTopBar {...baseProps} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders Start/Join buttons when idle + enabled', () => {
    render(<LiveSessionTopBar {...baseProps} isLiveSessionsEnabled={true} />);
    expect(screen.getByText(/start live session/i)).toBeInTheDocument();
    expect(screen.getByText(/join live session/i)).toBeInTheDocument();
  });

  it('renders presenter active state when role=presenter', () => {
    render(
      <LiveSessionTopBar {...baseProps} isSessionActive sessionRole="presenter" handRaises={[{} as any, {} as any]} />
    );
    expect(screen.getByText(/session active/i)).toBeInTheDocument();
    // Hand raise count rendered as "2"
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders attendee Alert when role=attendee', () => {
    render(
      <LiveSessionTopBar
        {...baseProps}
        isSessionActive
        sessionRole="attendee"
        sessionInfo={{ config: { name: 'Daily standup' }, sessionId: 'abc' } as any}
      />
    );
    expect(screen.getByText(/connected to: daily standup/i)).toBeInTheDocument();
    expect(screen.getByText(/leave/i)).toBeInTheDocument();
  });
});
