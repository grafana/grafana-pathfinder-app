import { css, keyframes } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

const slideUp = keyframes`
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
`;

export const getKioskOverlayStyles = (theme: GrafanaTheme2) => {
  const accent = theme.isDark ? '#8B7CF6' : '#6C63FF';

  return {
    backdrop: css({
      position: 'fixed',
      inset: 0,
      zIndex: 100000,
      background: theme.isDark ? 'rgba(0, 0, 0, 0.85)' : 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(12px)',
      display: 'flex',
      flexDirection: 'column',
      animation: `${fadeIn} 0.3s ease`,
      overflow: 'auto',
    }),
    container: css({
      maxWidth: '1200px',
      width: '100%',
      margin: '0 auto',
      padding: theme.spacing(4),
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(3),
    }),
    header: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: theme.spacing(2),
    }),
    titleGroup: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.5),
    }),
    title: css({
      fontSize: '28px',
      fontWeight: theme.typography.fontWeightBold,
      color: '#ffffff',
      margin: 0,
      letterSpacing: '-0.02em',
    }),
    subtitle: css({
      fontSize: theme.typography.body.fontSize,
      color: 'rgba(255, 255, 255, 0.6)',
      margin: 0,
    }),
    closeButton: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '40px',
      height: '40px',
      border: '1px solid rgba(255, 255, 255, 0.2)',
      borderRadius: '50%',
      background: 'rgba(255, 255, 255, 0.05)',
      color: 'rgba(255, 255, 255, 0.7)',
      cursor: 'pointer',
      fontSize: '20px',
      transition: 'all 0.2s ease',
      '&:hover': {
        background: 'rgba(255, 255, 255, 0.1)',
        borderColor: 'rgba(255, 255, 255, 0.4)',
        color: '#ffffff',
      },
    }),
    grid: css({
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
      gap: theme.spacing(2),
    }),
    loading: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing(8),
      color: 'rgba(255, 255, 255, 0.6)',
      fontSize: theme.typography.h4.fontSize,
    }),
    error: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing(8),
      color: theme.colors.error.text,
      fontSize: theme.typography.body.fontSize,
    }),
    tile: css({
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1.5),
      padding: theme.spacing(2.5),
      borderRadius: theme.spacing(1.5),
      border: `1px solid rgba(255, 255, 255, 0.08)`,
      background: `linear-gradient(135deg, rgba(255, 255, 255, 0.06) 0%, rgba(255, 255, 255, 0.02) 100%)`,
      cursor: 'pointer',
      transition: 'all 0.25s ease',
      animation: `${slideUp} 0.4s ease both`,
      overflow: 'hidden',
      '&::before': {
        content: '""',
        position: 'absolute',
        inset: 0,
        borderRadius: 'inherit',
        background: `linear-gradient(135deg, ${accent}15 0%, transparent 60%)`,
        opacity: 0,
        transition: 'opacity 0.25s ease',
      },
      '&:hover': {
        borderColor: `${accent}60`,
        transform: 'translateY(-4px)',
        boxShadow: `0 8px 32px rgba(0, 0, 0, 0.3), 0 0 20px ${accent}20`,
        '&::before': {
          opacity: 1,
        },
      },
      '&:active': {
        transform: 'translateY(-2px)',
      },
    }),
    tileIconRow: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    }),
    tileIcon: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '40px',
      height: '40px',
      borderRadius: theme.spacing(1),
      background: `${accent}20`,
      color: accent,
    }),
    tileBadge: css({
      display: 'inline-flex',
      alignItems: 'center',
      padding: `${theme.spacing(0.25)} ${theme.spacing(1)}`,
      borderRadius: theme.shape.radius.pill,
      background: `${accent}25`,
      color: accent,
      fontSize: '11px',
      fontWeight: theme.typography.fontWeightMedium,
      textTransform: 'capitalize',
    }),
    tileTitle: css({
      fontSize: theme.typography.h5.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: '#ffffff',
      margin: 0,
      lineHeight: 1.3,
      position: 'relative',
    }),
    tileDescription: css({
      fontSize: theme.typography.bodySmall.fontSize,
      color: 'rgba(255, 255, 255, 0.55)',
      margin: 0,
      lineHeight: 1.5,
      position: 'relative',
      display: '-webkit-box',
      WebkitLineClamp: 3,
      WebkitBoxOrient: 'vertical',
      overflow: 'hidden',
    }),
    tileArrow: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      color: accent,
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      marginTop: 'auto',
      paddingTop: theme.spacing(1),
      position: 'relative',
      opacity: 0.7,
      transition: 'opacity 0.2s ease',
      '.tile-hovered &': {
        opacity: 1,
      },
    }),
  };
};
