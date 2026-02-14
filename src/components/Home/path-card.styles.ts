/**
 * Path card styles
 *
 * Theme-aware styles for the learning path card and its guide list.
 */

import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { getColorPalette } from '../LearningPaths/learning-paths.styles';

export const getPathCardStyles = (theme: GrafanaTheme2) => {
  const colors = getColorPalette(theme);

  return {
    // ========================================================================
    // CARD
    // ========================================================================

    pathCard: css({
      borderRadius: theme.shape.radius.default,
      background: theme.colors.background.secondary,
      border: `1px solid ${theme.colors.border.weak}`,
      transition: 'all 0.2s ease',
      overflow: 'hidden',

      '&:hover': {
        borderColor: colors.pathAccent,
        boxShadow: `0 2px 8px ${colors.pathGlow}`,
      },
    }),
    pathCardCompleted: css({
      background: `linear-gradient(135deg, ${colors.successLight} 0%, ${theme.colors.background.secondary} 100%)`,
      borderColor: `${colors.success}50`,

      '&:hover': {
        borderColor: colors.success,
        boxShadow: `0 2px 8px ${colors.successGlow}`,
      },
    }),
    pathCardHeader: css({
      display: 'flex',
      alignItems: 'flex-start',
      gap: theme.spacing(2),
      padding: theme.spacing(2),
    }),
    pathIconWrap: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 40,
      height: 40,
      borderRadius: theme.shape.radius.default,
      backgroundColor: colors.pathAccentLight,
      color: colors.pathAccent,
      flexShrink: 0,
    }),
    pathIconWrapCompleted: css({
      backgroundColor: colors.successLight,
      color: colors.success,
    }),
    pathContent: css({
      flex: 1,
      minWidth: 0,
    }),
    pathTitle: css({
      margin: 0,
      fontSize: theme.typography.h5.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
      lineHeight: 1.3,
    }),
    pathTitleCompleted: css({
      color: colors.success,
    }),
    pathDescription: css({
      margin: `${theme.spacing(0.5)} 0 0`,
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      lineHeight: 1.5,
    }),
    pathMeta: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
      marginTop: theme.spacing(1),
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
    }),
    metaDot: css({
      color: theme.colors.text.disabled,
    }),
    progressBarTrack: css({
      flex: 1,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.progressTrack,
      overflow: 'hidden',
    }),
    progressBarFill: css({
      height: '100%',
      borderRadius: 2,
      backgroundColor: colors.pathAccent,
      transition: 'width 0.4s ease-out',
    }),
    progressBarFillCompleted: css({
      backgroundColor: colors.success,
    }),

    // ========================================================================
    // GUIDE LIST
    // ========================================================================

    guideList: css({
      display: 'flex',
      flexDirection: 'column',
      borderTop: `1px solid ${theme.colors.border.weak}`,
    }),
    guideItem: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1.5),
      padding: `${theme.spacing(1)} ${theme.spacing(2)}`,
      fontSize: theme.typography.body.fontSize,
      color: theme.colors.text.secondary,
      cursor: 'pointer',
      transition: 'background 0.15s ease',
      borderBottom: `1px solid ${theme.colors.border.weak}`,

      '&:last-child': {
        borderBottom: 'none',
      },

      '&:hover': {
        backgroundColor: theme.colors.action.hover,
      },
    }),
    guideItemCompleted: css({
      color: theme.colors.text.disabled,
    }),
    guideItemCurrent: css({
      color: theme.colors.text.primary,
      fontWeight: theme.typography.fontWeightMedium,
    }),
    guideIcon: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 20,
      height: 20,
      flexShrink: 0,
    }),
    guideIconCompleted: css({
      color: colors.success,
    }),
    guideIconCurrent: css({
      color: colors.pathAccent,
    }),
    guideIconPending: css({
      color: theme.colors.text.disabled,
    }),
    guideTitle: css({
      flex: 1,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }),
    guideTime: css({
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.disabled,
      whiteSpace: 'nowrap',
    }),
  };
};
