import React, { useCallback, useEffect, useState } from 'react';
import { css, keyframes } from '@emotion/css';
import { ThemeContext, type GrafanaTheme2 } from '@grafana/data';
import { t } from '@grafana/i18n';
import { config } from '@grafana/runtime';
import { IconButton, useStyles2 } from '@grafana/ui';

import { loadAchievementDefinitions, onAchievementAnnounced } from '../../completion-records/achievements';
import { testIds } from '../../constants/testIds';

import { AchievementBadge } from './AchievementBadge';
import { presentAnnouncement, type AnnouncementCard } from './announcement-presentation';

const TOAST_MS = 6000;
const OVERLAY_MS = 4000;
const MAX_TOASTS = 3;

/** Mounted in its own root at plugin init, so awards show with the docs panel closed. */
export function AchievementAnnouncementHost() {
  const [toasts, setToasts] = useState<AnnouncementCard[]>([]);
  const [overlays, setOverlays] = useState<AnnouncementCard[]>([]);

  useEffect(
    () =>
      onAchievementAnnounced((announcement) => {
        void loadAchievementDefinitions().then((definitions) => {
          const card = definitions && presentAnnouncement(announcement, definitions);
          if (!card) {
            return;
          }
          if (card.surface === 'overlay') {
            setOverlays((current) => [...current, card]);
          } else {
            setToasts((current) =>
              [...current.filter((c) => c.key !== card.key && !supersedes(card, c)), card].slice(-MAX_TOASTS)
            );
          }
        });
      }),
    []
  );

  const dismissToast = useCallback((key: string) => setToasts((current) => current.filter((c) => c.key !== key)), []);
  const dismissOverlay = useCallback(() => setOverlays((current) => current.slice(1)), []);

  if (toasts.length === 0 && overlays.length === 0) {
    return null;
  }
  return (
    <ThemeContext.Provider value={config.theme2}>
      <AchievementAnnouncementsView
        toasts={toasts}
        overlay={overlays[0] ?? null}
        onDismissToast={dismissToast}
        onDismissOverlay={dismissOverlay}
      />
    </ThemeContext.Provider>
  );
}

/** A newer card for an achievement replaces its showing progress toast, so a progress toast never sits beside an award. */
function supersedes(card: AnnouncementCard, showing: AnnouncementCard): boolean {
  return showing.kind === 'progress' && showing.achievementId === card.achievementId;
}

interface AchievementAnnouncementsViewProps {
  toasts: AnnouncementCard[];
  overlay: AnnouncementCard | null;
  onDismissToast: (key: string) => void;
  onDismissOverlay: () => void;
}

export function AchievementAnnouncementsView({
  toasts,
  overlay,
  onDismissToast,
  onDismissOverlay,
}: AchievementAnnouncementsViewProps) {
  const styles = useStyles2(getStyles);
  return (
    <>
      {overlay && <TierUpOverlay key={overlay.key} card={overlay} onDismiss={onDismissOverlay} />}
      <div className={styles.toastStack} role="status" aria-live="polite">
        {toasts.map((card) => (
          <AchievementToast key={card.key} card={card} onDismiss={onDismissToast} />
        ))}
      </div>
    </>
  );
}

function useAutoDismiss(ms: number, onDismiss: () => void): void {
  useEffect(() => {
    const timer = setTimeout(onDismiss, ms);
    return () => clearTimeout(timer);
  }, [ms, onDismiss]);
}

function AchievementToast({ card, onDismiss }: { card: AnnouncementCard; onDismiss: (key: string) => void }) {
  const styles = useStyles2(getStyles);
  const dismiss = useCallback(() => onDismiss(card.key), [card.key, onDismiss]);
  useAutoDismiss(TOAST_MS, dismiss);
  return (
    <div className={styles.toast} data-testid={testIds.achievements.toast(card.achievementId)}>
      <AchievementBadge artUrl={card.artUrl} size={48} />
      <div className={styles.toastBody}>
        <div className={styles.eyebrow}>{card.eyebrow}</div>
        <div className={styles.toastTitle}>{card.title}</div>
        <div className={styles.toastTier}>{card.detail}</div>
      </div>
      <IconButton
        name="times"
        size="md"
        onClick={dismiss}
        aria-label={t('achievements.announce.dismiss', 'Dismiss')}
        data-testid={testIds.achievements.toastDismiss}
      />
    </div>
  );
}

function TierUpOverlay({ card, onDismiss }: { card: AnnouncementCard; onDismiss: () => void }) {
  const styles = useStyles2(getStyles);
  useAutoDismiss(OVERLAY_MS, onDismiss);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onDismiss();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onDismiss]);
  return (
    <div className={styles.overlay} data-testid={testIds.achievements.overlay}>
      <div className={styles.overlayCard}>
        <IconButton
          className={styles.overlayClose}
          name="times"
          size="lg"
          onClick={onDismiss}
          aria-label={t('achievements.announce.dismiss', 'Dismiss')}
          data-testid={testIds.achievements.overlayDismiss}
        />
        <AchievementBadge artUrl={card.artUrl} size={160} className={styles.overlayBadge} />
        <div className={styles.eyebrow}>{card.eyebrow}</div>
        <h2 className={styles.overlayTitle}>{card.title}</h2>
        <div className={styles.overlayTier}>{card.detail}</div>
      </div>
    </div>
  );
}

const popIn = keyframes({
  from: { opacity: 0, transform: 'scale(0.85)' },
  to: { opacity: 1, transform: 'scale(1)' },
});

const slideIn = keyframes({
  from: { opacity: 0, transform: 'translateY(8px)' },
  to: { opacity: 1, transform: 'translateY(0)' },
});

const getStyles = (theme: GrafanaTheme2) => ({
  toastStack: css({
    position: 'fixed',
    right: theme.spacing(2),
    bottom: theme.spacing(2),
    zIndex: theme.zIndex.portal,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    width: `min(360px, calc(100vw - ${theme.spacing(4)}))`,
  }),
  toast: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    padding: theme.spacing(1.5),
    background: theme.colors.background.elevated,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    boxShadow: theme.shadows.z3,
    [theme.transitions.handleMotion('no-preference')]: {
      animation: `${slideIn} 200ms ease-out`,
    },
  }),
  toastBody: css({
    flex: 1,
    minWidth: 0,
  }),
  eyebrow: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  toastTitle: css({
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    overflowWrap: 'anywhere',
  }),
  toastTier: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.primary,
  }),
  overlay: css({
    position: 'fixed',
    inset: 0,
    zIndex: theme.zIndex.portal,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: theme.components.overlay.background,
    // Never blocks the page: clicks pass through everywhere except the card.
    pointerEvents: 'none',
  }),
  overlayCard: css({
    position: 'relative',
    pointerEvents: 'auto',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(4, 6),
    maxWidth: `calc(100vw - ${theme.spacing(4)})`,
    textAlign: 'center',
    background: theme.colors.background.elevated,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    boxShadow: theme.shadows.z3,
    [theme.transitions.handleMotion('no-preference')]: {
      animation: `${popIn} 250ms ease-out`,
    },
  }),
  overlayClose: css({
    position: 'absolute',
    top: theme.spacing(1),
    right: theme.spacing(1),
  }),
  overlayBadge: css({
    marginBottom: theme.spacing(1),
  }),
  overlayTitle: css({
    margin: 0,
    color: theme.colors.text.primary,
    overflowWrap: 'anywhere',
  }),
  overlayTier: css({
    color: theme.colors.text.secondary,
  }),
});
