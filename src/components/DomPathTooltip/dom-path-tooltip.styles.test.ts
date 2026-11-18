import { cache } from '@emotion/css';
import { createTheme } from '@grafana/data';
import { getDomPathTooltipStyles } from './dom-path-tooltip.styles';

const registeredStyles = (className: string) => cache.registered[className] ?? '';

describe('DOM path tooltip background', () => {
  const themes = [
    ['dark', createTheme({ colors: { mode: 'dark' } })],
    ['light', createTheme({ colors: { mode: 'light' } })],
    ['custom', createTheme({ colors: { mode: 'dark', background: { primary: '#123456' } } })],
  ] as const;

  it.each(themes)('derives the %s background from background.primary at 95% via color-mix', (_name, theme) => {
    const { tooltip } = getDomPathTooltipStyles(theme);
    const expected = `color-mix(in srgb, ${theme.colors.background.primary} 95%, transparent)`;

    expect(registeredStyles(tooltip)).toContain(`background-color:${expected}`);
  });

  it('does not use the previous fixed colors', () => {
    const { tooltip } = getDomPathTooltipStyles(createTheme({ colors: { mode: 'dark' } }));

    expect(registeredStyles(tooltip)).not.toContain('rgba(30, 30, 30, 0.95)');
  });
});

describe('DOM path tooltip testid highlight', () => {
  it.each([
    ['dark', createTheme({ colors: { mode: 'dark' } })],
    ['light', createTheme({ colors: { mode: 'light' } })],
  ] as const)('uses warning.text in the %s theme', (_name, theme) => {
    const { testidHighlight } = getDomPathTooltipStyles(theme);

    expect(registeredStyles(testidHighlight)).toContain(`color:${theme.colors.warning.text}`);
    expect(registeredStyles(testidHighlight)).not.toContain('#ff8800');
  });
});
