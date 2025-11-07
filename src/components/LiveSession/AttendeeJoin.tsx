/**
 * Attendee Join Interface for Live Sessions
 *
 * UI for attendees to join sessions using join codes, QR codes, or URLs
 */

import React, { useState, useEffect } from 'react';
import { Modal, Button, Input, Alert, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { parseJoinCode, parseSessionFromUrl, useSession } from '../../integrations/workshop';
import type { SessionOffer, AttendeeMode } from '../../types/collaboration.types';

/**
 * Get user-friendly error guidance based on error type
 */
function getErrorGuidance(error: unknown): { title: string; message: string; steps: string[] } {
  // Check if it's a SessionError with error code
  const errorMessage = error instanceof Error ? error.message : String(error);

  // Check for common error patterns
  if (errorMessage.includes('peer-unavailable') || errorMessage.includes('Could not connect to peer')) {
    return {
      title: 'Cannot Connect to Session',
      message: 'The presenter may not be online, or the join code may be incorrect.',
      steps: [
        'Verify the join code is correct',
        "Ensure the presenter's session is still active",
        'Check that you and the presenter are using the same PeerJS server',
        'Try refreshing the page and rejoining',
      ],
    };
  }

  if (errorMessage.includes('timeout') || errorMessage.includes('Peer connection timeout')) {
    return {
      title: 'Connection Timeout',
      message: 'Could not establish connection within the expected time.',
      steps: [
        'Check your network connection',
        'Ensure PeerJS server is running (if using local server)',
        'Try again in a few moments',
        'Contact your administrator if problem persists',
      ],
    };
  }

  if (errorMessage.includes('Invalid') || errorMessage.includes('invalid')) {
    return {
      title: 'Invalid Join Code',
      message: 'The join code format is not recognized.',
      steps: [
        'Double-check the join code for typos',
        'Request a new join code from the presenter',
        'Try copying and pasting the code instead of typing it',
      ],
    };
  }

  // Generic connection failure
  return {
    title: 'Connection Failed',
    message: 'Unable to join the session.',
    steps: [
      'Verify PeerJS server is running at the configured address',
      'Check that the join code is correct',
      'Ensure your network allows WebRTC connections',
      'Try in a different browser or incognito window',
      'Contact your administrator for help',
    ],
  };
}

/**
 * Error Alert Component - Helper to render error with guidance
 */
function ErrorAlert({ error, className }: { error: unknown; className: string }) {
  const guidance = getErrorGuidance(error);
  return (
    <Alert severity="error" title={guidance.title} className={className}>
      <div>
        <p>{guidance.message}</p>
        <p style={{ marginTop: '12px', fontWeight: 600 }}>Troubleshooting steps:</p>
        <ol style={{ marginTop: '8px', marginBottom: 0, paddingLeft: '20px' }}>
          {guidance.steps.map((step, idx) => (
            <li key={idx} style={{ marginBottom: '4px' }}>
              {step}
            </li>
          ))}
        </ol>
      </div>
    </Alert>
  );
}

/**
 * Props for AttendeeJoin
 */
interface AttendeeJoinProps {
  isOpen: boolean;
  onClose: () => void;
  onJoined: () => void;
}

/**
 * Attendee join component
 */
export function AttendeeJoin({ isOpen, onClose, onJoined }: AttendeeJoinProps) {
  const styles = useStyles2(getStyles);
  const { joinSession } = useSession();

  const [joinCode, setJoinCode] = useState('');
  const [mode, setMode] = useState<AttendeeMode>('guided');
  const [name, setName] = useState('');
  const [sessionOffer, setSessionOffer] = useState<SessionOffer | null>(null);
  const [error, setError] = useState<unknown | null>(null);
  const [isJoining, setIsJoining] = useState(false);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      // Reset all state when modal is closed
      setJoinCode('');
      setSessionOffer(null);
      setError(null);
      setMode('guided');
      setName('');
      setIsJoining(false);
    }
  }, [isOpen]);

  // Check for session in URL when opening, or reset to initial state
  useEffect(() => {
    if (isOpen) {
      try {
        const offerFromUrl = parseSessionFromUrl();
        if (offerFromUrl) {
          setSessionOffer(offerFromUrl);
        } else {
          // No session in URL - ensure we're at the join code input screen
          setSessionOffer(null);
          setJoinCode('');
          setError(null);
        }
      } catch (err) {
        // Parsing error - reset to join code input
        setSessionOffer(null);
        setJoinCode('');
        setError(null);
      }
    }
  }, [isOpen]);

  /**
   * Handle join code submission
   */
  const handleSubmitCode = () => {
    if (!joinCode.trim()) {
      setError('Please enter a join code');
      return;
    }

    setError(null);

    try {
      const trimmedCode = joinCode.trim();

      // Check if it's a full URL
      if (trimmedCode.startsWith('http://') || trimmedCode.startsWith('https://')) {
        // Extract query parameters from URL
        const url = new URL(trimmedCode);
        const sessionParam = url.searchParams.get('session');
        const sessionName = url.searchParams.get('sessionName');
        const tutorialUrl = url.searchParams.get('tutorialUrl');

        if (!sessionParam) {
          throw new Error('Invalid URL - no session parameter');
        }

        const offer = parseJoinCode(sessionParam);
        // Override with URL parameters if available
        const enrichedOffer = {
          ...offer,
          name: sessionName || offer.name,
          tutorialUrl: tutorialUrl || offer.tutorialUrl,
        };
        setSessionOffer(enrichedOffer);
      } else {
        // Plain join code
        const offer = parseJoinCode(trimmedCode);
        setSessionOffer(offer);
      }
    } catch (err) {
      setError('Invalid join code or URL. Please check and try again.');
    }
  };

  /**
   * Handle join session
   */
  const handleJoinSession = async () => {
    if (!sessionOffer) {
      return;
    }

    setError(null);
    setIsJoining(true);

    try {
      // Join session through context (handles state management)
      await joinSession(sessionOffer.id, mode, name || undefined);

      // Close modal and notify parent
      onJoined();
      onClose();
    } catch (err) {
      console.error('[AttendeeJoin] Failed to join session:', err);
      setError(err); // Store the actual error for better guidance
      setIsJoining(false);
    }
  };

  /**
   * Reset form
   */
  const handleClose = () => {
    setJoinCode('');
    setSessionOffer(null);
    setError(null);
    setMode('guided');
    setName('');
    onClose();
  };

  // Mode options
  const modeOptions = [
    {
      label: 'Guided',
      value: 'guided' as AttendeeMode,
      description: 'See highlights when presenter clicks "Show Me"',
    },
    {
      label: 'Follow',
      value: 'follow' as AttendeeMode,
      description: "Your Grafana mirrors presenter's actions",
    },
  ];

  return (
    <Modal title="Join Live Session" isOpen={isOpen} onDismiss={handleClose} className={styles.modal}>
      <div className={styles.container}>
        {!sessionOffer ? (
          // Step 1: Enter join code
          <>
            <div className={styles.section}>
              <label className={styles.label}>Enter Join Code</label>
              <p className={styles.helpText}>Get the join code from your presenter or scan their QR code</p>

              <div className={styles.inputGroup}>
                <Input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.currentTarget.value)}
                  placeholder="Paste join code here..."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSubmitCode();
                    }
                  }}
                  autoFocus
                />
                <Button onClick={handleSubmitCode} variant="primary">
                  Next
                </Button>
              </div>

              {error !== null && <ErrorAlert error={error} className={styles.alert} />}
            </div>

            <div className={styles.divider}>
              <span>OR</span>
            </div>

            <div className={styles.section}>
              <p className={styles.helpText}>Scan QR code with your mobile device or click a shared link</p>
            </div>
          </>
        ) : (
          // Step 2: Session preview and mode selection
          <>
            <div className={styles.sessionPreview}>
              <h4>Session Details</h4>
              <div className={styles.detailRow}>
                <strong>Name:</strong> {sessionOffer.name}
              </div>
              <div className={styles.detailRow}>
                <strong>Tutorial:</strong> {sessionOffer.tutorialUrl}
              </div>
            </div>

            <div className={styles.section}>
              <label className={styles.label}>Your Name (Optional)</label>
              <Input value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="Enter your name..." />
            </div>

            <div className={styles.section}>
              <label className={styles.label}>Select Mode</label>
              <div className={styles.modeSelector}>
                {modeOptions.map((option) => (
                  <div
                    key={option.value}
                    className={`${styles.modeOption} ${mode === option.value ? styles.modeOptionSelected : ''}`}
                    onClick={() => setMode(option.value)}
                  >
                    <div className={styles.modeRadio}>
                      <input type="radio" checked={mode === option.value} onChange={() => setMode(option.value)} />
                    </div>
                    <div className={styles.modeContent}>
                      <div className={styles.modeLabel}>{option.label}</div>
                      <div className={styles.modeDescription}>{option.description}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {error !== null && <ErrorAlert error={error} className={styles.alert} />}

            <div className={styles.actions}>
              <Button variant="secondary" onClick={() => setSessionOffer(null)}>
                Back
              </Button>
              <Button variant="primary" onClick={handleJoinSession} disabled={isJoining}>
                {isJoining ? 'Joining...' : 'Join Session'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/**
 * Styles
 */
function getStyles(theme: GrafanaTheme2) {
  return {
    modal: css`
      width: 600px;
      max-width: 90vw;
    `,
    container: css`
      padding: ${theme.spacing(2)};
    `,
    section: css`
      margin-bottom: ${theme.spacing(3)};
    `,
    label: css`
      display: block;
      font-weight: ${theme.typography.fontWeightMedium};
      margin-bottom: ${theme.spacing(1)};
    `,
    helpText: css`
      font-size: ${theme.typography.bodySmall.fontSize};
      color: ${theme.colors.text.secondary};
      margin-bottom: ${theme.spacing(1.5)};
    `,
    inputGroup: css`
      display: flex;
      gap: ${theme.spacing(1)};
    `,
    divider: css`
      display: flex;
      align-items: center;
      text-align: center;
      margin: ${theme.spacing(3)} 0;

      &::before,
      &::after {
        content: '';
        flex: 1;
        border-bottom: 1px solid ${theme.colors.border.medium};
      }

      span {
        padding: 0 ${theme.spacing(2)};
        color: ${theme.colors.text.secondary};
        font-size: ${theme.typography.bodySmall.fontSize};
      }
    `,
    sessionPreview: css`
      padding: ${theme.spacing(2)};
      background: ${theme.colors.background.secondary};
      border-radius: ${theme.shape.radius.default};
      margin-bottom: ${theme.spacing(2)};

      h4 {
        margin: 0 0 ${theme.spacing(1.5)} 0;
        font-size: ${theme.typography.h4.fontSize};
      }
    `,
    detailRow: css`
      margin-bottom: ${theme.spacing(1)};

      &:last-child {
        margin-bottom: 0;
      }

      strong {
        margin-right: ${theme.spacing(1)};
      }
    `,
    modeSelector: css`
      display: flex;
      flex-direction: column;
      gap: ${theme.spacing(1)};
    `,
    modeOption: css`
      display: flex;
      gap: ${theme.spacing(1.5)};
      padding: ${theme.spacing(2)};
      border: 2px solid ${theme.colors.border.medium};
      border-radius: ${theme.shape.radius.default};
      cursor: pointer;
      transition: all 0.2s;

      &:hover {
        border-color: ${theme.colors.border.strong};
        background: ${theme.colors.background.secondary};
      }
    `,
    modeOptionSelected: css`
      border-color: ${theme.colors.primary.main};
      background: ${theme.colors.primary.transparent};
    `,
    modeRadio: css`
      display: flex;
      align-items: flex-start;
      padding-top: 2px;

      input {
        cursor: pointer;
      }
    `,
    modeContent: css`
      flex: 1;
    `,
    modeLabel: css`
      font-weight: ${theme.typography.fontWeightMedium};
      margin-bottom: ${theme.spacing(0.5)};
    `,
    modeDescription: css`
      font-size: ${theme.typography.bodySmall.fontSize};
      color: ${theme.colors.text.secondary};
    `,
    alert: css`
      margin-top: ${theme.spacing(2)};
    `,
    actions: css`
      display: flex;
      gap: ${theme.spacing(1)};
      justify-content: flex-end;
      margin-top: ${theme.spacing(3)};
    `,
    codeInput: css`
      font-family: ${theme.typography.fontFamilyMonospace};
      font-size: ${theme.typography.bodySmall.fontSize};
    `,
  };
}
