import { GrafanaTheme2 } from '@grafana/data';
import { updateInteractiveThemeColors } from './interactive.styles';

const makeMockTheme = (isDark: boolean): GrafanaTheme2 =>
  ({
    isDark,
    colors: {
      background: { primary: isDark ? '#181b1f' : '#ffffff' },
      text: {
        primary: isDark ? '#d9d9d9' : '#1a1a1a',
        secondary: isDark ? '#999999' : '#666666',
      },
      border: { weak: isDark ? '#404040' : '#d0d0d0' },
    },
  }) as unknown as GrafanaTheme2;

const getProp = (name: string) => document.documentElement.style.getPropertyValue(name);

describe('updateInteractiveThemeColors', () => {
  afterEach(() => {
    // Clean up properties set on :root between tests
    document.documentElement.removeAttribute('style');
  });

  describe('dark mode', () => {
    it('sets --pathfinder-comment-bg to the theme primary background', () => {
      updateInteractiveThemeColors(makeMockTheme(true));
      expect(getProp('--pathfinder-comment-bg')).toBe('#181b1f');
    });

    it('sets --pathfinder-comment-close-color to the dark rgba value', () => {
      updateInteractiveThemeColors(makeMockTheme(true));
      expect(getProp('--pathfinder-comment-close-color')).toBe('rgba(255, 255, 255, 0.5)');
    });

    it('sets --pathfinder-comment-btn-border to the dark rgba value', () => {
      updateInteractiveThemeColors(makeMockTheme(true));
      expect(getProp('--pathfinder-comment-btn-border')).toBe('rgba(255, 255, 255, 0.2)');
    });

    it('sets --pathfinder-comment-kbd-bg to the dark rgba value', () => {
      updateInteractiveThemeColors(makeMockTheme(true));
      expect(getProp('--pathfinder-comment-kbd-bg')).toBe('rgba(255, 255, 255, 0.08)');
    });

    it('sets --pathfinder-comment-progress-bg to the dark rgba value', () => {
      updateInteractiveThemeColors(makeMockTheme(true));
      expect(getProp('--pathfinder-comment-progress-bg')).toBe('rgba(255, 255, 255, 0.1)');
    });
  });

  describe('light mode', () => {
    it('sets --pathfinder-comment-bg to the theme primary background', () => {
      updateInteractiveThemeColors(makeMockTheme(false));
      expect(getProp('--pathfinder-comment-bg')).toBe('#ffffff');
    });

    it('sets --pathfinder-comment-close-color to the light rgba value', () => {
      updateInteractiveThemeColors(makeMockTheme(false));
      expect(getProp('--pathfinder-comment-close-color')).toBe('rgba(0, 0, 0, 0.4)');
    });

    it('sets --pathfinder-comment-btn-border to the light rgba value', () => {
      updateInteractiveThemeColors(makeMockTheme(false));
      expect(getProp('--pathfinder-comment-btn-border')).toBe('rgba(0, 0, 0, 0.15)');
    });

    it('sets --pathfinder-comment-kbd-bg to the light rgba value', () => {
      updateInteractiveThemeColors(makeMockTheme(false));
      expect(getProp('--pathfinder-comment-kbd-bg')).toBe('rgba(0, 0, 0, 0.05)');
    });

    it('sets --pathfinder-comment-progress-bg to the light rgba value', () => {
      updateInteractiveThemeColors(makeMockTheme(false));
      expect(getProp('--pathfinder-comment-progress-bg')).toBe('rgba(0, 0, 0, 0.08)');
    });
  });

  describe('theme switching', () => {
    it('overwrites dark-mode properties when switching to light', () => {
      updateInteractiveThemeColors(makeMockTheme(true));
      expect(getProp('--pathfinder-comment-bg')).toBe('#181b1f');

      updateInteractiveThemeColors(makeMockTheme(false));
      expect(getProp('--pathfinder-comment-bg')).toBe('#ffffff');
      expect(getProp('--pathfinder-comment-close-color')).toBe('rgba(0, 0, 0, 0.4)');
    });

    it('overwrites light-mode properties when switching to dark', () => {
      updateInteractiveThemeColors(makeMockTheme(false));
      expect(getProp('--pathfinder-comment-bg')).toBe('#ffffff');

      updateInteractiveThemeColors(makeMockTheme(true));
      expect(getProp('--pathfinder-comment-bg')).toBe('#181b1f');
      expect(getProp('--pathfinder-comment-close-color')).toBe('rgba(255, 255, 255, 0.5)');
    });

    it('updates theme-derived properties (text, border) from the new theme object', () => {
      updateInteractiveThemeColors(makeMockTheme(true));
      expect(getProp('--pathfinder-comment-text')).toBe('#d9d9d9');

      updateInteractiveThemeColors(makeMockTheme(false));
      expect(getProp('--pathfinder-comment-text')).toBe('#1a1a1a');
      expect(getProp('--pathfinder-comment-border-weak')).toBe('#d0d0d0');
    });
  });
});
