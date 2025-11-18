/**
 * Styles for DOM path tooltip component
 */

import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

export const getDomPathTooltipStyles = (theme: GrafanaTheme2) => {
  return {
    tooltip: css({
      position: 'fixed',
      zIndex: 10000, // Above everything including highlights
      padding: theme.spacing(1, 1.5),
      backgroundColor: theme.isDark ? 'rgba(30, 30, 30, 0.95)' : 'rgba(255, 255, 255, 0.95)',
      color: theme.colors.text.primary,
      border: `1px solid ${theme.colors.border.medium}`,
      borderRadius: theme.shape.radius.default,
      fontSize: theme.typography.bodySmall.fontSize,
      fontFamily: theme.typography.fontFamilyMonospace,
      maxWidth: '600px',
      wordBreak: 'break-all',
      boxShadow: theme.shadows.z3,
      pointerEvents: 'none', // Don't interfere with mouse events
      whiteSpace: 'pre-wrap',
      lineHeight: 1.4,
    }),
    hidden: css({
      display: 'none',
    }),
  };
};
