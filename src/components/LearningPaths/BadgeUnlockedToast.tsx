/**
 * Badge Unlocked Toast Component
 *
 * Celebratory modal that appears when a badge is earned.
 * Features confetti animation, golden glow, and auto-dismiss.
 */

import React, { useEffect, useState, useMemo } from 'react';
import { useStyles2, Icon } from '@grafana/ui';

import type { BadgeUnlockedToastProps } from '../../types/learning-paths.types';
import { getBadgeUnlockedToastStyles, getColorPalette } from './learning-paths.styles';

// Auto-dismiss duration in milliseconds
const AUTO_DISMISS_DURATION = 5000;

/**
 * Celebratory toast for badge unlock
 */
export function BadgeUnlockedToast({ badge, onDismiss }: BadgeUnlockedToastProps) {
  const styles = useStyles2(getBadgeUnlockedToastStyles);
  const colors = useStyles2(getColorPalette);
  const [progress, setProgress] = useState(100);

  // Auto-dismiss timer with progress bar
  useEffect(() => {
    const startTime = Date.now();
    const endTime = startTime + AUTO_DISMISS_DURATION;

    const updateProgress = () => {
      const now = Date.now();
      const remaining = endTime - now;
      const newProgress = (remaining / AUTO_DISMISS_DURATION) * 100;

      if (newProgress <= 0) {
        onDismiss();
      } else {
        setProgress(newProgress);
        requestAnimationFrame(updateProgress);
      }
    };

    const animationId = requestAnimationFrame(updateProgress);

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [onDismiss]);

  // Generate confetti particles
  const confettiParticles = useMemo(() => {
    const confettiColors = [
      colors.badgeGold,
      '#FF6B6B',
      '#4ECDC4',
      '#45B7D1',
      '#96CEB4',
      '#FFEAA7',
    ];

    return Array.from({ length: 20 }, (_, i) => ({
      id: i,
      color: confettiColors[i % confettiColors.length],
      left: `${Math.random() * 100}%`,
      delay: `${Math.random() * 0.5}s`,
      size: 6 + Math.random() * 6,
    }));
  }, [colors.badgeGold]);

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
        {/* Confetti particles */}
        <div className={styles.confettiContainer}>
          {confettiParticles.map((particle) => (
            <div
              key={particle.id}
              className={styles.confetti}
              style={{
                left: particle.left,
                backgroundColor: particle.color,
                width: particle.size,
                height: particle.size,
                animationDelay: particle.delay,
                top: '100%',
              }}
            />
          ))}
        </div>

        {/* Header */}
        <div className={styles.header}>
          <Icon name="star" />
          <span>Achievement unlocked!</span>
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

        {/* Auto-dismiss progress bar */}
        <div className={styles.progressBar}>
          <div
            className={styles.progressFill}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
