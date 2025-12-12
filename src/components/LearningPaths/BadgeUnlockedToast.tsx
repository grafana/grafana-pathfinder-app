/**
 * Badge Unlocked Toast Component
 *
 * Celebratory modal that appears when a badge is earned.
 * Features confetti animation, glow effects, and auto-dismiss.
 * Uses CSS animations for smooth performance.
 */

import React, { useEffect, useRef } from 'react';
import { useStyles2, Icon } from '@grafana/ui';

import type { BadgeUnlockedToastProps } from '../../types/learning-paths.types';
import { getBadgeUnlockedToastStyles } from './learning-paths.styles';

// Auto-dismiss duration in milliseconds
const AUTO_DISMISS_DURATION = 5000;

// Static confetti config - pre-computed for performance (no random on each render)
const CONFETTI_PARTICLES = [
  { left: '10%', delay: '0s', color: 0 },
  { left: '25%', delay: '0.1s', color: 1 },
  { left: '40%', delay: '0.2s', color: 2 },
  { left: '55%', delay: '0.15s', color: 3 },
  { left: '70%', delay: '0.25s', color: 4 },
  { left: '85%', delay: '0.05s', color: 5 },
  { left: '15%', delay: '0.3s', color: 2 },
  { left: '50%', delay: '0.1s', color: 0 },
  { left: '75%', delay: '0.2s', color: 1 },
  { left: '30%', delay: '0.15s', color: 3 },
];

// Confetti uses vibrant greens and accent colors matching our success theme (#22C55E)
const CONFETTI_COLORS = ['#22C55E', '#16A34A', '#4ADE80', '#86EFAC', '#4ECDC4', '#A3E635'];

/**
 * Celebratory toast for badge unlock
 */
export function BadgeUnlockedToast({ badge, onDismiss }: BadgeUnlockedToastProps) {
  const styles = useStyles2(getBadgeUnlockedToastStyles);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-dismiss timer - simple timeout, no state updates during animation
  useEffect(() => {
    timerRef.current = setTimeout(() => {
      onDismiss();
    }, AUTO_DISMISS_DURATION);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [onDismiss]);

  // Handle click outside to dismiss
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onDismiss();
    }
  };

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onDismiss();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onDismiss]);

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.toast} role="dialog" aria-labelledby="badge-title">
        {/* Confetti particles - static config, pure CSS animation */}
        <div className={styles.confettiContainer}>
          {CONFETTI_PARTICLES.map((particle, i) => (
            <div
              key={i}
              className={styles.confetti}
              style={{
                left: particle.left,
                backgroundColor: CONFETTI_COLORS[particle.color],
                animationDelay: particle.delay,
              }}
            />
          ))}
        </div>

        {/* Header */}
        <div className={styles.header}>
          <Icon name="star" />
          <span>Badge unlocked!</span>
        </div>

        {/* Auto-dismiss progress bar - uses pure CSS animation for smooth performance */}
        <div className={styles.progressBar}>
          <div className={styles.progressFill} />
        </div>

        {/* Badge icon */}
        <div className={styles.badgeContainer}>
          <Icon name={badge.icon as any} size="xxxl" className={styles.badgeIcon} />
        </div>

        {/* Badge info */}
        <h2 id="badge-title" className={styles.badgeTitle}>
          {badge.title}
        </h2>
        <p className={styles.badgeDescription}>
          {badge.description}
        </p>

        {/* Dismiss button */}
        <button className={styles.dismissButton} onClick={onDismiss}>
          Nice!
        </button>
      </div>
    </div>
  );
}
