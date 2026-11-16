import type { GrafanaTheme2 } from '@grafana/data';

export const getLearningCardInteractionStyles = (theme: GrafanaTheme2) => ({
  transition: 'none',
  '&:hover': {
    borderColor: theme.colors.border.strong,
    backgroundImage: `linear-gradient(${theme.colors.action.hover}, ${theme.colors.action.hover})`,
  },
  '&[data-selected="true"]': {
    borderColor: theme.colors.text.primary,
    backgroundImage: `linear-gradient(${theme.colors.action.selected}, ${theme.colors.action.selected})`,
  },
  '&:focus-visible': { outline: `2px solid ${theme.colors.text.primary}`, outlineOffset: 2 },
});
