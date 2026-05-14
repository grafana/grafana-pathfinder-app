import { GrafanaTheme2 } from '@grafana/data';

/**
 * Updates CSS custom properties for interactive comment boxes based on the current theme.
 * This function should be called whenever the theme might change to ensure the comment
 * box popups (which are rendered outside the React tree as global DOM elements) respect
 * the user's light/dark mode preference.
 *
 * The custom properties are written to :root (document.documentElement) and intentionally
 * persist — no cleanup is required. They are namespaced under --pathfinder-* to avoid
 * collisions with Grafana's own CSS variables.
 *
 * @param theme - The current Grafana theme
 */
export const updateInteractiveThemeColors = (theme: GrafanaTheme2): void => {
  const root = document.documentElement;
  const isDark = theme.isDark;

  // Background and text colors
  root.style.setProperty('--pathfinder-comment-bg', theme.colors.background.primary);
  root.style.setProperty('--pathfinder-comment-text', theme.colors.text.primary);
  root.style.setProperty('--pathfinder-comment-text-secondary', theme.colors.text.secondary);
  root.style.setProperty('--pathfinder-comment-border-weak', theme.colors.border.weak);

  // UI element colors (buttons, close icons, etc.)
  // These need different opacities for light vs dark mode to maintain contrast
  root.style.setProperty(
    '--pathfinder-comment-close-color',
    isDark ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.4)'
  );
  root.style.setProperty(
    '--pathfinder-comment-close-hover-bg',
    isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)'
  );
  root.style.setProperty(
    '--pathfinder-comment-close-hover-color',
    isDark ? 'rgba(255, 255, 255, 0.9)' : 'rgba(0, 0, 0, 0.8)'
  );

  // Button and input borders
  root.style.setProperty(
    '--pathfinder-comment-btn-border',
    isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.15)'
  );
  root.style.setProperty('--pathfinder-comment-btn-text', isDark ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.7)');
  root.style.setProperty(
    '--pathfinder-comment-btn-hover-bg',
    isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.06)'
  );
  root.style.setProperty(
    '--pathfinder-comment-btn-hover-border',
    isDark ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.25)'
  );
  root.style.setProperty('--pathfinder-comment-btn-hover-text', isDark ? '#ffffff' : '#000000');

  // Progress and indicator colors
  root.style.setProperty(
    '--pathfinder-comment-progress-bg',
    isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)'
  );
  root.style.setProperty('--pathfinder-comment-dot-bg', isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.15)');

  // Code element colors
  root.style.setProperty('--pathfinder-comment-code-bg', isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.06)');
  root.style.setProperty(
    '--pathfinder-comment-code-border',
    isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.12)'
  );

  // Keyboard hints
  root.style.setProperty('--pathfinder-comment-kbd-text', isDark ? 'rgba(255, 255, 255, 0.35)' : 'rgba(0, 0, 0, 0.35)');
  root.style.setProperty('--pathfinder-comment-kbd-bg', isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)');
  root.style.setProperty(
    '--pathfinder-comment-kbd-border',
    isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.1)'
  );

  // Border top for button container
  root.style.setProperty('--pathfinder-comment-divider', isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)');

  // Form validation status colors
  root.style.setProperty('--pathfinder-form-checking-bg', isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)');
  root.style.setProperty(
    '--pathfinder-form-checking-border',
    isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.12)'
  );
  root.style.setProperty('--pathfinder-form-checking-text', isDark ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.7)');
};
