/**
 * LearningGraphSection — collapsible wrapper for the LearningGraph canvas.
 *
 * Starts collapsed so the ~200 KB React Flow bundle is only downloaded
 * when the learner first opens the section (React.lazy + Suspense).
 */

import React, { Suspense, useState, useCallback } from 'react';
import { useStyles2, Icon, Spinner } from '@grafana/ui';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

const LearningGraph = React.lazy(() => import('./LearningGraph').then((m) => ({ default: m.LearningGraph })));

// ============ STYLES ============

function getSectionStyles(theme: GrafanaTheme2) {
  return {
    section: css({
      marginTop: theme.spacing(2),
    }),
    header: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
      padding: `${theme.spacing(1)} ${theme.spacing(0)}`,
      cursor: 'pointer',
      userSelect: 'none',
      borderBottom: `1px solid ${theme.colors.border.weak}`,
      marginBottom: theme.spacing(1),
      '&:hover': {
        color: theme.colors.text.primary,
      },
    }),
    headerTitle: css({
      fontSize: theme.typography.h5.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
      margin: 0,
      flex: 1,
    }),
    headerIcon: css({
      color: theme.colors.text.secondary,
    }),
    beta: css({
      fontSize: '10px',
      padding: '1px 6px',
      borderRadius: '3px',
      background: theme.colors.warning.transparent,
      color: theme.colors.warning.text,
      border: `1px solid ${theme.colors.warning.border}`,
      fontWeight: theme.typography.fontWeightMedium,
    }),
    fallback: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: 200,
      gap: theme.spacing(1),
      color: theme.colors.text.secondary,
    }),
  };
}

// ============ PROPS ============

interface LearningGraphSectionProps {
  graphUrl: string;
  completedGuides: string[];
  onOpenGuide: (url: string, title: string) => void;
}

// ============ COMPONENT ============

export function LearningGraphSection({ graphUrl, completedGuides, onOpenGuide }: LearningGraphSectionProps) {
  const styles = useStyles2(getSectionStyles);
  const [isOpen, setIsOpen] = useState(false);

  const toggleOpen = useCallback(() => setIsOpen((prev) => !prev), []);

  return (
    <div className={styles.section}>
      <div
        className={styles.header}
        onClick={toggleOpen}
        role="button"
        aria-expanded={isOpen}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleOpen();
          }
        }}
      >
        <Icon name="sitemap" size="md" className={styles.headerIcon} />
        <h2 className={styles.headerTitle}>Learning map</h2>
        <span className={styles.beta}>Beta</span>
        <Icon name={isOpen ? 'angle-up' : 'angle-down'} size="md" className={styles.headerIcon} />
      </div>

      {isOpen && (
        <Suspense
          fallback={
            <div className={styles.fallback}>
              <Spinner size="lg" />
              <span>Loading learning map…</span>
            </div>
          }
        >
          <LearningGraph graphUrl={graphUrl} completedGuides={completedGuides} onOpenGuide={onOpenGuide} />
        </Suspense>
      )}
    </div>
  );
}
