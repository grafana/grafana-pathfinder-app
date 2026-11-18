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
      '--kiosk-gap': { compact: '12px', normal: '24px', spacious: '40px' }[appearance.density],
      '--kiosk-hero-padding': appearance.density === 'compact' ? '12px 16px' : '32px',
      '--kiosk-section-padding': appearance.density === 'compact' ? '16px' : '24px',
      '--kiosk-heading-margin': appearance.density === 'compact' ? '8px 0' : '16px 0',
      '--kiosk-title-medium': appearance.density === 'compact' ? '1.5rem' : 'clamp(1.5rem, 3vw, 2rem)',
      '--kiosk-title-large': appearance.density === 'compact' ? '2rem' : 'clamp(2rem, 4vw, 3rem)',
      '--kiosk-title-extra-large': appearance.density === 'compact' ? '2.5rem' : 'clamp(2.5rem, 5vw, 4rem)',
      '--kiosk-column-title': appearance.density === 'compact' ? '1.25rem' : 'clamp(1.4rem, 2.4vw, 1.8rem)',
      '--kiosk-image-height': appearance.density === 'compact' ? 'clamp(100px, 20vh, 160px)' : 'none',
      '--kiosk-action-spacing': appearance.density === 'compact' ? '8px' : '24px',
      '--kiosk-header-padding': appearance.density === 'compact' ? '12px 0' : '24px 0',
      '--kiosk-footer-padding': appearance.density === 'compact' ? '4px 0' : '16px 0',
      '--kiosk-bottom-padding': appearance.density === 'compact' ? '12px' : '32px',
    }),
    borderRadius: 'var(--kiosk-radius, 8px)',
  });
}
