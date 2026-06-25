import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { GrafanaTheme2, ThemeContext } from '@grafana/data';
import { Button, useStyles2 } from '@grafana/ui';
import { config } from '@grafana/runtime';
import { css } from '@emotion/css';
import { type PendingChallenge, onPendingChallenge, acceptSession, rejectSession } from '../../lib/pairing-manager';

function useLiveTheme() {
  const [theme, setTheme] = useState(() => config.theme2);
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'class') {
          setTheme(config.theme2);
          break;
        }
      }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

function getBannerStyles(theme: GrafanaTheme2) {
  return {
    backdrop: css({
      position: 'fixed',
      bottom: theme.spacing(2),
      right: theme.spacing(2),
      zIndex: 99999,
      maxWidth: 400,
    }),
    dialog: css({
      backgroundColor: theme.colors.background.secondary,
      border: `1px solid ${theme.colors.border.medium}`,
      borderRadius: theme.shape.radius.default,
      boxShadow: theme.shadows.z3,
      padding: theme.spacing(2),
    }),
    heading: css({
      ...theme.typography.h5,
      margin: 0,
      marginBottom: theme.spacing(0.5),
      color: theme.colors.text.primary,
    }),
    body: css({
      ...theme.typography.bodySmall,
      color: theme.colors.text.secondary,
      marginBottom: theme.spacing(2),
    }),
    actions: css({
      display: 'flex',
      gap: theme.spacing(1),
      justifyContent: 'flex-end',
    }),
  };
}

interface BannerDialogProps {
  challenge: PendingChallenge;
  onAccept: () => void;
  onReject: () => void;
}

function BannerDialog({ challenge, onAccept, onReject }: BannerDialogProps) {
  const styles = useStyles2(getBannerStyles);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onReject();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onReject]);

  return (
    <div className={styles.backdrop}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="pathfinder-pairing-title"
        aria-describedby="pathfinder-pairing-desc"
        className={styles.dialog}
      >
        <p id="pathfinder-pairing-title" className={styles.heading}>
          Interactive learning controller wants to connect
        </p>
        <p id="pathfinder-pairing-desc" className={styles.body}>
          A controller tab ({challenge.senderTabId.slice(0, 8)}…) is requesting permission to run interactive steps on
          this Grafana tab. Accept only if you opened the controller yourself.
        </p>
        <div className={styles.actions}>
          <Button variant="secondary" size="sm" onClick={onReject}>
            Reject
          </Button>
          <Button variant="primary" size="sm" onClick={onAccept} autoFocus>
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}

function PairingBannerInner() {
  const theme = useLiveTheme();
  const [challenge, setChallenge] = useState<PendingChallenge | null>(null);

  useEffect(() => {
    return onPendingChallenge(setChallenge);
  }, []);

  if (!challenge) {
    return null;
  }

  const handleAccept = () => {
    acceptSession();
  };

  const handleReject = () => {
    rejectSession();
  };

  return createPortal(
    <ThemeContext.Provider value={theme}>
      <BannerDialog challenge={challenge} onAccept={handleAccept} onReject={handleReject} />
    </ThemeContext.Provider>,
    document.body
  );
}

export function PairingRequestBanner() {
  return <PairingBannerInner />;
}
