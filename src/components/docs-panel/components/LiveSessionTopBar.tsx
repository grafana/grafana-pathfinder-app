/**
 * Top-bar JSX for the docs-panel live-session surface.
 *
 * Renders one of three states above the tab bar:
 *   - Idle: "Start live session" + "Join live session" buttons (only when
 *     live sessions are enabled by config)
 *   - Active as presenter: "Session active" pill + hand-raise indicator
 *   - Active as attendee: success Alert with mode toggle, hand-raise
 *     button, and leave button
 *
 * Behavior preserved verbatim from the inline JSX in docs-panel.tsx.
 * The wrapper only renders when (isLiveSessionsEnabled || isSessionActive)
 * — match the original gate exactly so the surrounding layout / spacing
 * does not change for users who have live sessions disabled.
 */
import React, { type RefObject } from 'react';
import { Alert, Button, ButtonGroup, Icon } from '@grafana/ui';
import { HandRaiseButton, HandRaiseIndicator } from '../../LiveSession';
import { FOLLOW_MODE_ENABLED } from '../../../integrations/workshop/flags';
import type { AttendeeMode, HandRaiseInfo, SessionInfo, SessionRole } from '../../../types/collaboration.types';
import { SessionManager } from '../../../integrations/workshop';
import type { LogSession } from '../hooks/useDevModeLogger';

export interface LiveSessionTopBarProps {
  className: string;
  liveSessionButtonsClassName: string;
  isLiveSessionsEnabled: boolean | undefined;
  isSessionActive: boolean;
  sessionRole: SessionRole | null;
  sessionInfo: SessionInfo | null;
  sessionManager: SessionManager | null;
  handRaises: HandRaiseInfo[];
  handRaiseIndicatorRef: RefObject<HTMLDivElement>;
  attendeeMode: AttendeeMode | null;
  setAttendeeMode: (mode: AttendeeMode) => void;
  actionReplayRef: RefObject<{ setMode: (mode: AttendeeMode) => void } | null>;
  isHandRaised: boolean;
  onHandRaiseToggle: (raised: boolean) => void;
  onShowPresenterControls: () => void;
  onShowAttendeeJoin: () => void;
  onShowHandRaiseQueue: () => void;
  endSession: () => void;
  logSession: LogSession;
}

export function LiveSessionTopBar(props: LiveSessionTopBarProps): React.ReactElement | null {
  const {
    className,
    liveSessionButtonsClassName,
    isLiveSessionsEnabled,
    isSessionActive,
    sessionRole,
    sessionInfo,
    sessionManager,
    handRaises,
    handRaiseIndicatorRef,
    attendeeMode,
    setAttendeeMode,
    actionReplayRef,
    isHandRaised,
    onHandRaiseToggle,
    onShowPresenterControls,
    onShowAttendeeJoin,
    onShowHandRaiseQueue,
    endSession,
    logSession,
  } = props;

  if (!isLiveSessionsEnabled && !isSessionActive) {
    return null;
  }

  return (
    <div className={className}>
      <div className={liveSessionButtonsClassName}>
        {!isSessionActive && isLiveSessionsEnabled && (
          <>
            <Button
              size="sm"
              variant="secondary"
              icon="users-alt"
              onClick={onShowPresenterControls}
              tooltip="Start a live session to broadcast your actions to attendees"
            >
              Start live session
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="user"
              onClick={onShowAttendeeJoin}
              tooltip="Join an existing live session"
            >
              Join live session
            </Button>
          </>
        )}
        {isSessionActive && sessionRole === 'presenter' && (
          <>
            <Button size="sm" variant="primary" icon="circle" onClick={onShowPresenterControls}>
              Session active
            </Button>
            <div ref={handRaiseIndicatorRef}>
              <HandRaiseIndicator count={handRaises.length} onClick={onShowHandRaiseQueue} />
            </div>
          </>
        )}
        {isSessionActive && sessionRole === 'attendee' && (
          <Alert title="" severity="success" style={{ margin: 0, padding: '8px 12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Icon name="check-circle" />
                <span style={{ fontWeight: 500 }}>Connected to: {sessionInfo?.config.name || 'Live session'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                {FOLLOW_MODE_ENABLED && (
                  <>
                    <span style={{ fontSize: '12px', color: 'rgba(204, 204, 220, 0.85)' }}>Mode:</span>
                    <ButtonGroup>
                      <Button
                        size="sm"
                        variant={attendeeMode === 'guided' ? 'primary' : 'secondary'}
                        onClick={() => {
                          if (attendeeMode !== 'guided') {
                            const newMode: AttendeeMode = 'guided';
                            setAttendeeMode(newMode);
                            if (actionReplayRef.current) {
                              actionReplayRef.current.setMode(newMode);
                            }
                            if (sessionManager) {
                              sessionManager.sendToPresenter({
                                type: 'mode_change',
                                sessionId: sessionInfo?.sessionId || '',
                                timestamp: Date.now(),
                                senderId: sessionManager.getRole() || 'attendee',
                                mode: newMode,
                              } as any);
                            }
                            logSession('[DocsPanel] Switched to Guided mode');
                          }
                        }}
                        tooltip="Only see highlights when presenter clicks Show Me"
                      >
                        Guided
                      </Button>
                      <Button
                        size="sm"
                        variant={attendeeMode === 'follow' ? 'primary' : 'secondary'}
                        onClick={() => {
                          if (attendeeMode !== 'follow') {
                            const newMode: AttendeeMode = 'follow';
                            setAttendeeMode(newMode);
                            if (actionReplayRef.current) {
                              actionReplayRef.current.setMode(newMode);
                            }
                            if (sessionManager) {
                              sessionManager.sendToPresenter({
                                type: 'mode_change',
                                sessionId: sessionInfo?.sessionId || '',
                                timestamp: Date.now(),
                                senderId: sessionManager.getRole() || 'attendee',
                                mode: newMode,
                              } as any);
                            }
                            logSession('[DocsPanel] Switched to Follow mode');
                          }
                        }}
                        tooltip="Execute actions automatically when presenter clicks Do It"
                      >
                        Follow
                      </Button>
                    </ButtonGroup>
                  </>
                )}
                <HandRaiseButton isRaised={isHandRaised} onToggle={onHandRaiseToggle} />
                <Button
                  size="sm"
                  variant="secondary"
                  icon="times"
                  onClick={() => {
                    if (confirm('Leave this live session?')) {
                      endSession();
                    }
                  }}
                  tooltip="Leave the live session"
                >
                  Leave
                </Button>
              </div>
            </div>
          </Alert>
        )}
      </div>
    </div>
  );
}
