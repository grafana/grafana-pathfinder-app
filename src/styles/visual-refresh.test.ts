import { cache } from '@emotion/css';
import { createTheme } from '@grafana/data';
import { getContainerStyles as contextContainer } from './context-panel.styles';
import { getContainerStyles as docsContainer } from './docs-panel.styles';
import { getInteractiveStyles } from './interactive.styles';
import { journeyContentHtml } from './content-html.styles';

const rules = (className: string) => cache.registered[className];

describe.each(['dark', 'light'] as const)('visual refresh in %s mode', (mode) => {
  const theme = createTheme({ colors: { mode } });
  theme.colors.background.page = mode === 'dark' ? '#040608' : '#f8f9fa';
  theme.colors.accent.main = '#f59e4b';
  theme.colors.accent.mainEmphasis = '#d78030';
  theme.shape.radius.md = '7px';
  theme.shape.radius.lg = '11px';

  it.each([contextContainer, docsContainer])('gates shell page backgrounds on the theme refresh flag', (getStyles) => {
    theme.flags.visualDesignRefresh = false;
    expect(rules(getStyles(theme).container)).toContain(`background-color:${theme.colors.background.primary}`);
    theme.flags.visualDesignRefresh = true;
    expect(rules(getStyles(theme).container)).toContain(`background-color:${theme.colors.background.page}`);
  });

  it('uses accent for guided progress and leaves the loading spinner circular', () => {
    const styles = rules(getInteractiveStyles(theme));
    expect(styles).toContain(`border-top-color:${theme.colors.accent.main}`);
    expect(styles).toContain(
      `linear-gradient(90deg, ${theme.colors.accent.main} 0%, ${theme.colors.accent.mainEmphasis} 100%)`
    );
    expect(styles).toContain('border-radius:50%');
    expect(styles).toContain('border-radius:7px');
    expect(styles).toContain('border-radius:11px');
  });

  it('uses accent rather than primary for guide callout borders', () => {
    expect(rules(journeyContentHtml(theme))).toContain(`border-left:3px solid ${theme.colors.accent.main}`);
  });
});
