import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { kioskBackgroundColors, kioskForeground, type KioskAppearance } from '../../types/kiosk-page.schema';

export function kioskAppearanceClass(appearance: KioskAppearance | undefined, theme: GrafanaTheme2): string {
  const background = appearance?.background;
  const preset = appearance?.preset;
  const color = background
    ? kioskForeground(kioskBackgroundColors(background))
    : preset === 'bold'
      ? '#ffffff'
      : preset
        ? theme.colors.text.primary
        : undefined;
  const backgroundValue =
    background?.type === 'solid'
      ? background.color
      : background?.type === 'gradient'
        ? `linear-gradient(${background.direction === 'right' ? '90deg' : background.direction === 'down' ? '180deg' : '135deg'}, ${background.from}, ${background.to})`
        : preset === 'bold'
          ? 'linear-gradient(135deg, #211141, #542659)'
          : preset === 'subtle'
            ? theme.colors.background.secondary
            : preset === 'grafana'
              ? theme.colors.background.canvas
              : undefined;
  return css({
    ...(backgroundValue && { background: backgroundValue }),
    ...(color && { color, '--kiosk-text': color }),
    ...(appearance?.accentColor && {
      '--kiosk-accent': appearance.accentColor,
      '--kiosk-action-background': appearance.accentColor,
      '--kiosk-action-foreground': kioskForeground([appearance.accentColor]),
    }),
    ...(appearance?.radius && { '--kiosk-radius': { none: '0px', small: '4px', large: '20px' }[appearance.radius] }),
    ...(appearance?.density && {
      '--kiosk-gap': { compact: '16px', normal: '24px', spacious: '40px' }[appearance.density],
    }),
    borderRadius: 'var(--kiosk-radius, 8px)',
  });
}
