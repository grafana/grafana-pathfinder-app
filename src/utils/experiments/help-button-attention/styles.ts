import { css, keyframes } from '@emotion/css';
import { colorManipulator, type GrafanaTheme2 } from '@grafana/data';

export function getHelpButtonAttentionStyle(theme: GrafanaTheme2): string {
  const accent = theme.colors.warning.main;
  const pulse = keyframes({
    '0%, 100%': { boxShadow: `0 0 0 1px ${colorManipulator.alpha(accent, 0.65)}` },
    '50%': {
      boxShadow: `0 0 0 3px ${colorManipulator.alpha(accent, 0.2)}, 0 0 12px ${colorManipulator.alpha(accent, 0.3)}`,
    },
  });
  return css({
    '&&': {
      color: theme.colors.warning.text,
      backgroundColor: colorManipulator.alpha(accent, 0.1),
      borderRadius: theme.shape.radius.default,
      boxShadow: `0 0 0 1px ${colorManipulator.alpha(accent, 0.65)}`,
      animation: `${pulse} 4s ease-in-out infinite`,
      '&:hover, &:focus-visible': { animation: 'none' },
      '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
      '@media (forced-colors: active)': { animation: 'none', outline: '1px solid Highlight' },
    },
  });
}
