import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';

export function getLearningIconTileStyle(
  theme: GrafanaTheme2,
  size: number,
  { tint, bright = false }: { tint?: string; bright?: boolean } = {}
) {
  return css({
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: theme.spacing(size),
    height: theme.spacing(size),
    flexShrink: 0,
    color: tint ?? theme.colors.text.primary,
    border: tint
      ? '1px solid transparent'
      : `1px solid ${bright ? theme.colors.border.medium : theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.md,
    boxSizing: 'border-box',
    isolation: 'isolate',
    '&::before': {
      content: '""',
      position: 'absolute',
      inset: theme.spacing(0.25),
      backgroundColor: bright ? theme.colors.background.elevated : theme.colors.background.secondary,
      backgroundImage: bright
        ? `linear-gradient(${theme.colors.action.hover}, ${theme.colors.action.hover})`
        : tint
          ? `linear-gradient(oklch(from ${tint} l c h / 12%), oklch(from ${tint} l c h / 12%))`
          : undefined,
      borderRadius: `calc(${theme.shape.radius.md} - 1px - ${theme.spacing(0.25)})`,
      zIndex: -1,
      pointerEvents: 'none',
    },
  });
}
