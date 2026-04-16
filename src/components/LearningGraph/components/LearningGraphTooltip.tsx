/**
 * Detail tooltip shown when a node is clicked.
 *
 * Displays node metadata and a CTA that opens the guide in the Pathfinder
 * sidebar via the auto-launch-tutorial custom event mechanism.
 */

import React, { useCallback } from 'react';
import { useStyles2, Icon, Button } from '@grafana/ui';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import type { GraphNode } from '../../../types/package.types';
import { resolveContentUrl } from '../utils';

interface LearningGraphTooltipProps {
  node: GraphNode;
  isCompleted: boolean;
  onClose: () => void;
  onOpenGuide: (url: string, title: string) => void;
}

function getTooltipStyles(theme: GrafanaTheme2) {
  return {
    overlay: css({
      position: 'fixed',
      inset: 0,
      zIndex: 1000,
    }),
    card: css({
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      background: theme.colors.background.primary,
      border: `1px solid ${theme.colors.border.medium}`,
      borderRadius: theme.shape.radius.default,
      boxShadow: theme.shadows.z3,
      padding: theme.spacing(2),
      minWidth: 260,
      maxWidth: 340,
      zIndex: 1001,
    }),
    header: css({
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: theme.spacing(1),
    }),
    title: css({
      fontSize: theme.typography.h5.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
      margin: 0,
      paddingRight: theme.spacing(1),
    }),
    closeButton: css({
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      color: theme.colors.text.secondary,
      padding: 0,
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      '&:hover': {
        color: theme.colors.text.primary,
      },
    }),
    typeBadge: css({
      display: 'inline-block',
      fontSize: '11px',
      padding: '2px 8px',
      borderRadius: '3px',
      background: theme.colors.background.canvas,
      color: theme.colors.text.secondary,
      border: `1px solid ${theme.colors.border.weak}`,
      marginBottom: theme.spacing(1),
      textTransform: 'capitalize',
    }),
    completedBadge: css({
      display: 'inline-block',
      fontSize: '11px',
      padding: '2px 8px',
      borderRadius: '3px',
      background: theme.colors.success.transparent,
      color: theme.colors.success.text,
      border: `1px solid ${theme.colors.success.border}`,
      marginBottom: theme.spacing(1),
      marginLeft: theme.spacing(0.5),
    }),
    description: css({
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      margin: `${theme.spacing(1)} 0`,
      lineHeight: 1.5,
    }),
    actions: css({
      marginTop: theme.spacing(1.5),
      display: 'flex',
      gap: theme.spacing(1),
    }),
  };
}

export function LearningGraphTooltip({ node, isCompleted, onClose, onOpenGuide }: LearningGraphTooltipProps) {
  const styles = useStyles2(getTooltipStyles);

  const handleOpen = useCallback(() => {
    const contentUrl = resolveContentUrl(node);
    const title = node.title ?? node.id;
    onOpenGuide(contentUrl, title);
    onClose();
  }, [node, onOpenGuide, onClose]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <p className={styles.title}>{node.title ?? node.id}</p>
          <button className={styles.closeButton} onClick={onClose} aria-label="Close">
            <Icon name="times" size="md" />
          </button>
        </div>

        <span className={styles.typeBadge}>{node.type}</span>
        {isCompleted && <span className={styles.completedBadge}>Completed</span>}

        {node.description && <p className={styles.description}>{node.description}</p>}

        {node.category && (
          <p className={styles.description}>
            Category: <strong>{node.category}</strong>
          </p>
        )}

        <div className={styles.actions}>
          <Button size="sm" variant="primary" onClick={handleOpen}>
            {isCompleted ? 'Review guide' : 'Start guide'}
          </Button>
          <Button size="sm" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
