/**
 * Presenter Controls for Live Sessions
 *
 * UI for presenters to create sessions, share join codes, and monitor attendees
 */

import React, { useState } from 'react';
import { Button, Input, Alert, useStyles2, Badge } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { useSession } from '../../integrations/workshop';
import { ConnectionIndicator } from './ConnectionIndicator';
import type { SessionConfig, AttendeeInfo } from '../../types/collaboration.types';

/**
 * Props for PresenterControls
 */
interface PresenterControlsProps {
  /** Current tutorial URL to use for session */
  tutorialUrl: string;
}

/**
 * Presenter controls component
 */
export function PresenterControls({ tutorialUrl }: PresenterControlsProps) {
  const styles = useStyles2(getStyles);
  const { createSession, sessionInfo, endSession, attendees } = useSession();

  const [isCreating, setIsCreating] = useState(false);
  const [sessionName, setSessionName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'code' | 'url' | null>(null);

  /**
   * Handle create session
   */
  const handleCreateSession = async () => {
    if (!sessionName.trim()) {
      setError('Please enter a session name');
      return;
    }

    if (!tutorialUrl || tutorialUrl.trim() === '') {
      setError(
        'Please open a tutorial before creating a session. Open a learning journey or documentation page first.'
      );
      return;
    }

    setError(null);
    setIsCreating(true);

    try {
      const config: SessionConfig = {
        name: sessionName,
        tutorialUrl,
        defaultMode: 'guided',
      };

      await createSession(config);
      console.log('[PresenterControls] Session created successfully');
    } catch (err) {
      console.error('[PresenterControls] Failed to create session:', err);
      setError('Failed to create session. Please try again.');
    } finally {
      setIsCreating(false);
    }
  };

  /**
   * Copy text to clipboard
   */
  const copyToClipboard = async (text: string, type: 'code' | 'url') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    } catch (error) {
      console.error('[PresenterControls] Failed to copy:', error);
    }
  };

  /**
   * Handle end session
   */
  const handleEndSession = () => {
    if (confirm('Are you sure you want to end this session? All attendees will be disconnected.')) {
      endSession();
    }
  };

  // If session is active, show session info
  if (sessionInfo) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <h3>Live Session Active</h3>
          <div className={styles.liveIndicator}>
            <span className={styles.liveDot} />
            LIVE
          </div>
        </div>

        <div className={styles.activeSessionContainer}>
          {/* Left Column: Join Information */}
          <div className={styles.leftColumn}>
            <div className={styles.sessionInfo}>
              <div className={styles.infoRow}>
                <strong>Session:</strong> {sessionInfo.config.name}
              </div>
            </div>

            <div className={styles.shareSection}>
              <h4>Share with Attendees</h4>

              <div className={styles.shareItem}>
                <label>Session Code</label>
                <p className={styles.helpText}>Share this 6-character code with attendees</p>
                <div className={styles.copyGroup}>
                  <Input
                    value={sessionInfo.joinCode}
                    readOnly
                    className={styles.codeInput}
                    style={{ fontSize: '24px', fontWeight: 'bold', textAlign: 'center', letterSpacing: '4px' }}
                  />
                  <Button variant="secondary" size="sm" onClick={() => copyToClipboard(sessionInfo.joinCode, 'code')}>
                    {copied === 'code' ? '✓ Copied' : 'Copy'}
                  </Button>
                </div>
              </div>

              <div className={styles.shareItem}>
                <label>Join URL</label>
                <div className={styles.copyGroup}>
                  <Input value={sessionInfo.joinUrl} readOnly className={styles.urlInput} />
                  <Button variant="secondary" size="sm" onClick={() => copyToClipboard(sessionInfo.joinUrl, 'url')}>
                    {copied === 'url' ? '✓ Copied' : 'Copy'}
                  </Button>
                </div>
              </div>

              {sessionInfo.qrCode && (
                <div className={styles.qrSection}>
                  <label>QR Code</label>
                  <img src={sessionInfo.qrCode} alt="QR Code" className={styles.qrCode} />
                  <p className={styles.helpText}>Attendees can scan this to join instantly</p>
                </div>
              )}
            </div>

            <div className={styles.actions}>
              <Button variant="destructive" onClick={handleEndSession}>
                End Session
              </Button>
            </div>
          </div>

          {/* Right Column: Attendee List */}
          <div className={styles.rightColumn}>
            <div className={styles.attendeeListHeader}>
              <h4>Attendees</h4>
              <span className={styles.attendeeCount}>{attendees.length}</span>
            </div>

            {attendees.length === 0 ? (
              <div className={styles.emptyState}>
                <p>Waiting for attendees to join...</p>
              </div>
            ) : (
              <div className={styles.scrollableAttendeeList}>
                {attendees.map((attendee: AttendeeInfo) => {
                  return (
                    <div key={attendee.id} className={styles.attendeeItem}>
                      <span className={styles.attendeeName}>{attendee.name || 'Anonymous'}</span>
                      <Badge
                        text={attendee.mode === 'guided' ? 'Guided' : 'Follow'}
                        color={attendee.mode === 'guided' ? 'orange' : 'blue'}
                      />
                      <ConnectionIndicator
                        state={attendee.connectionState}
                        quality={attendee.connectionQuality}
                        showLabel={false}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Otherwise, show create session form
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3>Start Live Session</h3>
      </div>

      <div className={styles.form}>
        <div className={styles.formGroup}>
          <label>Session Name</label>
          <Input
            value={sessionName}
            onChange={(e) => setSessionName(e.currentTarget.value)}
            placeholder="e.g., Prometheus Workshop - Jan 2025"
            disabled={isCreating}
          />
        </div>

        <div className={styles.formGroup}>
          <label>Tutorial</label>
          {tutorialUrl ? (
            <>
              <Input value={tutorialUrl} readOnly disabled />
              <p className={styles.helpText}>✓ This tutorial will be used for the session</p>
            </>
          ) : (
            <>
              <Alert severity="warning" title="" style={{ marginTop: '8px', marginBottom: '8px' }}>
                No tutorial open. Please open a learning journey or docs page in a tab first.
              </Alert>
            </>
          )}
        </div>

        {error && (
          <Alert severity="error" title="Error">
            {error}
          </Alert>
        )}

        <Button
          variant="primary"
          onClick={handleCreateSession}
          disabled={isCreating || !sessionName.trim() || !tutorialUrl}
        >
          {isCreating ? 'Creating Session...' : 'Create Session'}
        </Button>
      </div>
    </div>
  );
}

/**
 * Styles
 */
function getStyles(theme: GrafanaTheme2) {
  return {
    container: css`
      padding: ${theme.spacing(2)};
      background: ${theme.colors.background.primary};
      border-radius: ${theme.shape.radius.default};
      border: 1px solid ${theme.colors.border.medium};
    `,
    header: css`
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: ${theme.spacing(2)};

      h3 {
        margin: 0;
        font-size: ${theme.typography.h3.fontSize};
      }
    `,
    liveIndicator: css`
      display: flex;
      align-items: center;
      gap: ${theme.spacing(1)};
      color: ${theme.colors.error.text};
      font-weight: ${theme.typography.fontWeightBold};
      font-size: ${theme.typography.bodySmall.fontSize};
    `,
    liveDot: css`
      width: 8px;
      height: 8px;
      background: ${theme.colors.error.main};
      border-radius: 50%;
      animation: pulse 2s infinite;

      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.5;
        }
      }
    `,
    activeSessionContainer: css`
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: ${theme.spacing(3)};

      @media (max-width: 900px) {
        grid-template-columns: 1fr;
      }
    `,
    leftColumn: css`
      display: flex;
      flex-direction: column;
      gap: ${theme.spacing(2)};
    `,
    rightColumn: css`
      display: flex;
      flex-direction: column;
      gap: ${theme.spacing(2)};
      border-left: 1px solid ${theme.colors.border.medium};
      padding-left: ${theme.spacing(3)};

      @media (max-width: 900px) {
        border-left: none;
        padding-left: 0;
        border-top: 1px solid ${theme.colors.border.medium};
        padding-top: ${theme.spacing(3)};
      }
    `,
    attendeeListHeader: css`
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: ${theme.spacing(1)};

      h4 {
        margin: 0;
        font-size: ${theme.typography.h4.fontSize};
      }
    `,
    attendeeCount: css`
      font-size: ${theme.typography.h4.fontSize};
      font-weight: ${theme.typography.fontWeightBold};
      color: ${theme.colors.primary.text};
    `,
    scrollableAttendeeList: css`
      max-height: 400px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: ${theme.spacing(0.5)};
    `,
    emptyState: css`
      padding: ${theme.spacing(3)};
      text-align: center;
      color: ${theme.colors.text.secondary};
      font-style: italic;
    `,
    form: css`
      display: flex;
      flex-direction: column;
      gap: ${theme.spacing(2)};
    `,
    formGroup: css`
      display: flex;
      flex-direction: column;
      gap: ${theme.spacing(0.5)};

      label {
        font-weight: ${theme.typography.fontWeightMedium};
        font-size: ${theme.typography.bodySmall.fontSize};
      }
    `,
    helpText: css`
      font-size: ${theme.typography.bodySmall.fontSize};
      color: ${theme.colors.text.secondary};
      margin: ${theme.spacing(0.5)} 0 0 0;
    `,
    sessionInfo: css`
      padding: ${theme.spacing(2)};
      background: ${theme.colors.background.secondary};
      border-radius: ${theme.shape.radius.default};
      margin-bottom: ${theme.spacing(2)};
    `,
    infoRow: css`
      margin-bottom: ${theme.spacing(1)};

      &:last-child {
        margin-bottom: 0;
      }
    `,
    shareSection: css`
      margin-bottom: ${theme.spacing(2)};

      h4 {
        margin: 0 0 ${theme.spacing(1.5)} 0;
        font-size: ${theme.typography.h4.fontSize};
      }
    `,
    shareItem: css`
      margin-bottom: ${theme.spacing(2)};

      label {
        display: block;
        font-weight: ${theme.typography.fontWeightMedium};
        font-size: ${theme.typography.bodySmall.fontSize};
        margin-bottom: ${theme.spacing(0.5)};
      }
    `,
    copyGroup: css`
      display: flex;
      gap: ${theme.spacing(1)};
    `,
    codeInput: css`
      font-family: ${theme.typography.fontFamilyMonospace};
      font-size: ${theme.typography.bodySmall.fontSize};
    `,
    urlInput: css`
      font-family: ${theme.typography.fontFamilyMonospace};
      font-size: ${theme.typography.bodySmall.fontSize};
    `,
    qrSection: css`
      text-align: center;
      padding: ${theme.spacing(2)};
      background: ${theme.colors.background.secondary};
      border-radius: ${theme.shape.radius.default};

      label {
        display: block;
        font-weight: ${theme.typography.fontWeightMedium};
        margin-bottom: ${theme.spacing(1)};
      }
    `,
    addAttendeeSection: css`
      margin: ${theme.spacing(3)} 0;
      padding: ${theme.spacing(2)};
      background: ${theme.colors.background.secondary};
      border-radius: ${theme.shape.radius.default};
      border: 1px dashed ${theme.colors.border.medium};

      h4 {
        margin: 0 0 ${theme.spacing(1)} 0;
        font-size: ${theme.typography.h4.fontSize};
      }
    `,
    qrCode: css`
      max-width: 300px;
      width: 100%;
      height: auto;
      margin: ${theme.spacing(1)} 0;
    `,
    attendeesList: css`
      margin-bottom: ${theme.spacing(2)};

      h4 {
        margin: 0 0 ${theme.spacing(1)} 0;
        font-size: ${theme.typography.h4.fontSize};
      }
    `,
    attendeeItem: css`
      display: flex;
      align-items: center;
      gap: ${theme.spacing(1)};
      padding: ${theme.spacing(1)};
      background: ${theme.colors.background.secondary};
      border-radius: ${theme.shape.radius.default};
      margin-bottom: ${theme.spacing(0.5)};
    `,
    attendeeName: css`
      flex: 1;
    `,
    actions: css`
      display: flex;
      gap: ${theme.spacing(1)};
      justify-content: flex-end;
    `,
  };
}
