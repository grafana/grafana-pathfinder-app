import { cache } from '@emotion/css';
import { createTheme, colorManipulator } from '@grafana/data';
import { getSelectionStyles } from './content-renderer.styles';

const selectionRules = (className: string) =>
  Array.from(document.styleSheets).flatMap((sheet) =>
    Array.from(sheet.cssRules).filter((rule) => rule.cssText.includes(`.${className}`))
  );

describe.each(['dark', 'light'] as const)('guide text selection in %s mode', (mode) => {
  const theme = createTheme({ colors: { mode } });

  it('should override Prism selection for the guide root and all descendants with a contrasting theme pair', () => {
    const className = getSelectionStyles(theme);
    const rule = selectionRules(className).find((rule) => rule instanceof CSSStyleRule) as CSSStyleRule;

    expect(rule.selectorText).toBe(`.${className}.${className}::selection,.${className}.${className} ::selection`);
    expect(rule.style.getPropertyValue('background-color')).toBe(theme.colors.primary.main);
    expect(rule.style.color).toBe(theme.colors.primary.contrastText);
    expect(rule.style.getPropertyValue('text-shadow')).toBe('none');
    expect(
      colorManipulator.getContrastRatio(theme.colors.primary.main, theme.colors.primary.contrastText)
    ).toBeGreaterThanOrEqual(4.5);
    expect(cache.registered[className]).not.toContain('!important');
  });

  it('should respect system selection colors in forced-colors mode without disabling automatic adjustment', () => {
    const className = getSelectionStyles(theme);
    const mediaRule = selectionRules(className).find((rule) => rule instanceof CSSMediaRule) as CSSMediaRule;

    expect(mediaRule).toBeDefined();
    expect(mediaRule.conditionText).toBe('(forced-colors: active)');
    const rule = mediaRule.cssRules[0] as CSSStyleRule;
    expect(rule.selectorText).toBe(`.${className}.${className}::selection,.${className}.${className} ::selection`);
    expect(rule.style.getPropertyValue('background-color')).toBe('Highlight');
    expect(rule.style.color).toBe('HighlightText');
    expect(cache.registered[className]).not.toContain('forced-color-adjust');
  });
});
