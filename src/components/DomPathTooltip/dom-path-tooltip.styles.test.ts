import { cache } from '@emotion/css';
import { createTheme, colorManipulator } from '@grafana/data';
import { getDomPathTooltipStyles } from './dom-path-tooltip.styles';

const registeredStyles = (className: string) => cache.registered[className] ?? '';

describe('DOM path tooltip background', () => {
  const themes = [
    ['dark', createTheme({ colors: { mode: 'dark' } })],
    ['light', createTheme({ colors: { mode: 'light' } })],
    ['custom', createTheme({ colors: { mode: 'dark', background: { primary: '#123456' } } })],
  ] as const;

  it.each(themes)('derives the %s background from background.primary at 0.95 alpha', (_name, theme) => {
    const { tooltip } = getDomPathTooltipStyles(theme);
    const expected = colorManipulator.alpha(theme.colors.background.primary, 0.95);

    expect(registeredStyles(tooltip)).toContain(`background-color:${expected}`);
  });

  it('does not use the previous fixed colors', () => {
    const { tooltip } = getDomPathTooltipStyles(createTheme({ colors: { mode: 'dark' } }));

    expect(registeredStyles(tooltip)).not.toContain('rgba(30, 30, 30, 0.95)');
  });
});
