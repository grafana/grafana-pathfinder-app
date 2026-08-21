/**
 * Live-session modal cluster for the docs panel.
 *
 * Renders:
 *   - Presenter-controls modal (two near-identical visual variants for
 *     idle vs active-presenter — the two-modal pattern is preserved
 *     verbatim from the original inline JSX)
 *   - AttendeeJoin modal
 *   - HandRaiseQueue popover anchored to the indicator
 *
 * `ModalBackdrop` is intentionally NOT moved here: it sits as a sibling
 * after these modals in the renderer (covers presenter-controls AND the
 * attendee-join form), and lifting it would change the JSX tree order
 * around the badge-celebration toast.
 */
import React, { type RefObject } from 'react';
import { IconButton } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { AttendeeJoin, HandRaiseQueue, PresenterControls } from '../../LiveSession';
import type { HandRaiseInfo, SessionRole } from '../../../types/collaboration.types';

export interface LiveSessionModalsProps {
  theme: GrafanaTheme2;
  showPresenterControls: boolean;
  isSessionActive: boolean;
  sessionRole: SessionRole | null;
  showAttendeeJoin: boolean;
  showHandRaiseQueue: boolean;
  handRaises: HandRaiseInfo[];
  handRaiseIndicatorRef: RefObject<HTMLDivElement>;
  presenterTutorialUrl: string;
  onClosePresenterControls: () => void;
  onCloseAttendeeJoin: () => void;
  onAttendeeJoined: () => void;
  onCloseHandRaiseQueue: () => void;
}

function modalContainerStyle(theme: GrafanaTheme2): React.CSSProperties {
  return {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    zIndex: 10000,
    background: theme.colors.background.primary,
    borderRadius: theme.shape.radius.default,
    boxShadow: theme.shadows.z3,
    padding: theme.spacing(3),
    maxWidth: '600px',
    maxHeight: '90vh',
    overflow: 'auto',
  };
}

function modalHeaderStyle(theme: GrafanaTheme2): React.CSSProperties {
  return {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing(2),
  };
}

export function LiveSessionModals(props: LiveSessionModalsProps): React.ReactElement {
  const {
    theme,
    showPresenterControls,
    isSessionActive,
    sessionRole,
    showAttendeeJoin,
    showHandRaiseQueue,
    handRaises,
    handRaiseIndicatorRef,
    presenterTutorialUrl,
    onClosePresenterControls,
    onCloseAttendeeJoin,
    onAttendeeJoined,
    onCloseHandRaiseQueue,
  } = props;

  return (
    <>
      {showPresenterControls && !isSessionActive && (
        <div style={modalContainerStyle(theme)}>
          <div style={modalHeaderStyle(theme)}>
            <h3 style={{ margin: 0 }}>Live Session</h3>
            <IconButton name="times" size="lg" onClick={onClosePresenterControls} aria-label="Close" />
          </div>
          <PresenterControls tutorialUrl={presenterTutorialUrl} />
        </div>
      )}

      {showPresenterControls && isSessionActive && sessionRole === 'presenter' && (
        <div style={modalContainerStyle(theme)}>
          <div style={modalHeaderStyle(theme)}>
            <h3 style={{ margin: 0 }}>Live Session</h3>
            <IconButton name="times" size="lg" onClick={onClosePresenterControls} aria-label="Close" />
          </div>
          <PresenterControls tutorialUrl={presenterTutorialUrl} />
        </div>
      )}

      <AttendeeJoin isOpen={showAttendeeJoin} onClose={onCloseAttendeeJoin} onJoined={onAttendeeJoined} />

      <HandRaiseQueue
        handRaises={handRaises}
        isOpen={showHandRaiseQueue}
        onClose={onCloseHandRaiseQueue}
        anchorRef={handRaiseIndicatorRef}
      />
    </>
  );
}
