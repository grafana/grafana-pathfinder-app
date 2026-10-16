import { css, keyframes } from '@emotion/css';
import { colorManipulator, type GrafanaTheme2 } from '@grafana/data';

import type { LearnButton } from './controller';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STAR_PATH = 'M12 1l2.2 8.8L23 12l-8.8 2.2L12 23l-2.2-8.8L1 12l8.8-2.2z';
const SPARKLES = [
  { size: 14, top: -7, right: -7, delay: 0 },
  { size: 10, bottom: -6, left: 10, delay: 0.7 },
  { size: 8, top: -5, left: 34, delay: 1.4 },
] as const;

function svg(attributes: Record<string, string>, paths: string[]): SVGSVGElement {
  const element = document.createElementNS(SVG_NS, 'svg');
  for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' })) {
    element.setAttribute(name, value);
  }
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    element.append(path);
  }
  return element;
}

function getStyles(theme: GrafanaTheme2) {
  const accent = theme.colors.action.selectedBorder;
  const twinkle = keyframes({
    '0%, 100%': { opacity: 0, transform: 'scale(0.4)' },
    '50%': { opacity: 1, transform: 'scale(1)' },
  });
  return css({
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    height: theme.spacing(theme.components.height.md),
    padding: theme.spacing(0, 1.5),
    border: `1px solid ${accent}`,
    borderRadius: theme.shape.radius.default,
    background: `linear-gradient(180deg, ${colorManipulator.alpha(accent, 0.28)}, ${colorManipulator.alpha(accent, 0.12)})`,
    color: theme.colors.text.primary,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    '&:hover': { background: colorManipulator.alpha(accent, 0.32) },
    '&:focus-visible': { outline: `2px solid ${theme.colors.primary.main}`, outlineOffset: 1 },
    '& [data-sparkle]': {
      display: 'none',
      position: 'absolute',
      pointerEvents: 'none',
      fill: theme.isDark ? colorManipulator.lighten(accent, 0.6) : accent,
      animation: `${twinkle} 2.2s ease-in-out infinite`,
    },
    '&[data-attention="true"] [data-sparkle]': { display: 'block' },
    '@media (prefers-reduced-motion: reduce)': { '& [data-sparkle]': { animation: 'none', opacity: 0.8 } },
    '@media (forced-colors: active)': { '&[data-attention="true"] [data-sparkle]': { display: 'none' } },
  });
}

export function showLearnButton(
  help: HTMLButtonElement,
  theme: GrafanaTheme2,
  label: string,
  onClick: () => void
): LearnButton {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.testid = 'help-button-learn';
  button.className = getStyles(theme);
  const icon = svg(
    {
      width: '18',
      height: '18',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.7',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    },
    ['M12 4L2 9l10 5 10-5-10-5z', 'M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5', 'M22 9v6']
  );
  const text = document.createElement('span');
  text.textContent = label;
  button.append(icon, text);
  for (const { size, delay, ...offsets } of SPARKLES) {
    const sparkle = svg({ width: String(size), height: String(size) }, [STAR_PATH]);
    sparkle.dataset.sparkle = '';
    sparkle.style.animationDelay = `${delay}s`;
    for (const [side, value] of Object.entries(offsets)) {
      sparkle.style.setProperty(side, `${value}px`);
    }
    button.append(sparkle);
  }
  button.addEventListener('click', onClick);
  help.before(button);
  return {
    element: button,
    setAttention: (attention) => {
      const value = String(attention);
      if (button.dataset.attention !== value) {
        button.dataset.attention = value;
      }
    },
    remove: () => {
      button.removeEventListener('click', onClick);
      button.remove();
    },
  };
}
