import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { css } from '@emotion/css';
import { ThemeContext, type GrafanaTheme2 } from '@grafana/data';
import { config } from '@grafana/runtime';
import { Button, useStyles2 } from '@grafana/ui';
import { testIds } from '../../constants/testIds';

function useGrafanaTheme() {
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

const getBannerStyles = (theme: GrafanaTheme2) => ({
  banner: css({
    position: 'fixed',
    bottom: theme.spacing(3),
    right: theme.spacing(3),
    zIndex: 99999,
    background: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    padding: theme.spacing(2),
    boxShadow: theme.shadows.z3,
    maxWidth: '360px',
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
  }),
  heading: css({
    margin: 0,
    fontSize: theme.typography.h5.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
  }),
  body: css({
    margin: 0,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  actions: css({
    display: 'flex',
    gap: theme.spacing(1),
  }),
});

interface BannerInnerProps {
  senderId: string;
  onAccept: () => void;
  onReject: () => void;
}

function BannerInner({ senderId, onAccept, onReject }: BannerInnerProps) {
  const styles = useStyles2(getBannerStyles);

  const handleAccept = () => {
    window.dispatchEvent(new CustomEvent('pathfinder-pairing-accepted', { detail: { senderId } }));
    onAccept();
  };

  const handleReject = () => {
    window.dispatchEvent(new CustomEvent('pathfinder-pairing-rejected', { detail: { senderId } }));
    onReject();
  };

  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Pairing request"
      data-testid={testIds.pairingBanner.banner}
      className={styles.banner}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          handleReject();
        }
      }}
    >
      <p className={styles.heading}>Allow Pathfinder to control this tab?</p>
      <p className={styles.body}>A Pathfinder controller tab is requesting to guide you through interactive steps.</p>
      <div className={styles.actions}>
        <Button
          variant="primary"
          onClick={handleAccept}
          autoFocus
          data-testid={testIds.pairingBanner.acceptButton}
        >
          Accept
        </Button>
        <Button variant="secondary" onClick={handleReject} data-testid={testIds.pairingBanner.rejectButton}>
          Reject
        </Button>
      </div>
    </div>,
    document.body
  );
}

export function PairingRequestBanner() {
  const theme = useGrafanaTheme();
  const [pendingSenderId, setPendingSenderId] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const { senderId } = (e as CustomEvent<{ senderId: string }>).detail;
      setPendingSenderId(senderId);
    };
    window.addEventListener('pathfinder-pairing-request', handler);
    return () => window.removeEventListener('pathfinder-pairing-request', handler);
  }, []);

  if (!pendingSenderId) {
    return null;
  }

  return (
    <ThemeContext.Provider value={theme}>
      <BannerInner
        senderId={pendingSenderId}
        onAccept={() => setPendingSenderId(null)}
        onReject={() => setPendingSenderId(null)}
      />
    </ThemeContext.Provider>
  );
}
