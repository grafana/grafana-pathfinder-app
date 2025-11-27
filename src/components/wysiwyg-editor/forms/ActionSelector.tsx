import React from 'react';
import { Button, useStyles2, Icon, IconName } from '@grafana/ui';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { getSelectableActions, ActionDefinition } from './actionRegistry';

interface ActionSelectorProps {
  onSelect: (actionType: string) => void;
  onCancel: () => void;
}

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    padding: theme.spacing(2),
  }),
  description: css({
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing(2.5),
    marginTop: 0,
    fontSize: theme.typography.body.fontSize,
  }),
  grid: css({
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
    gap: theme.spacing(1.5),
    marginBottom: theme.spacing(2.5),
  }),
  // Card-style action button
  actionCard: css({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    padding: theme.spacing(2),
    backgroundColor: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    cursor: 'pointer',
    transition: 'all 0.15s ease-in-out',
    textAlign: 'left',
    height: '100%',
    minHeight: '100px',

    '&:hover': {
      backgroundColor: theme.colors.background.secondary,
      borderColor: theme.colors.border.medium,
      transform: 'translateY(-2px)',
      boxShadow: theme.shadows.z2,
    },

    '&:focus': {
      outline: 'none',
      borderColor: theme.colors.primary.border,
      boxShadow: `0 0 0 2px ${theme.colors.primary.border}`,
    },

    '&:active': {
      transform: 'translateY(0)',
    },
  }),
  actionCardHeader: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(1),
    width: '100%',
  }),
  actionIconWrapper: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    borderRadius: theme.shape.radius.default,
    backgroundColor: theme.colors.action.hover,
    color: theme.colors.text.primary,
    flexShrink: 0,
  }),
  actionName: css({
    fontWeight: theme.typography.fontWeightMedium,
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.text.primary,
  }),
  actionDescription: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    lineHeight: 1.4,
    marginTop: 'auto',
  }),
  // Fallback emoji icon style
  emojiIcon: css({
    fontSize: '18px',
    lineHeight: 1,
  }),
  footer: css({
    display: 'flex',
    justifyContent: 'flex-end',
    paddingTop: theme.spacing(1),
    borderTop: `1px solid ${theme.colors.border.weak}`,
  }),
});

// Map action types to valid Grafana icon names
const getGrafanaIcon = (action: ActionDefinition): IconName | null => {
  // Map common icon names to valid Grafana icons
  const iconMap: Record<string, IconName> = {
    'gf-button': 'enter',
    star: 'star',
    'document-info': 'document-info',
    compass: 'compass',
    mouse: 'draggabledots',
    'clipboard-list': 'list-ul',
    'folder-open': 'folder-open',
  };

  const grafanaIconName = action.ui.grafanaIcon;
  if (grafanaIconName && iconMap[grafanaIconName]) {
    return iconMap[grafanaIconName];
  }
  return null;
};

/**
 * Component for selecting an interactive action type
 *
 * Redesigned with card-based layout for better visual hierarchy.
 * Uses Grafana icons when available, with emoji fallback.
 *
 * Note: Sequence action type is hidden from this selector because it's
 * handled by the "Add Section" button in the toolbar.
 */
const ActionSelector = ({ onSelect, onCancel }: ActionSelectorProps) => {
  const styles = useStyles2(getStyles);

  // Get selectable actions (excludes hidden ones like SEQUENCE)
  const selectableActions = getSelectableActions();

  return (
    <div className={styles.container}>
      <p className={styles.description}>Choose the type of interaction for this element</p>

      <div className={styles.grid}>
        {selectableActions.map((action) => {
          const iconName = getGrafanaIcon(action);

          return (
            <button
              key={action.type}
              className={styles.actionCard}
              onClick={() => onSelect(action.type)}
              type="button"
              aria-label={`Select ${action.ui.name} action`}
            >
              <div className={styles.actionCardHeader}>
                <div className={styles.actionIconWrapper}>
                  {iconName ? (
                    <Icon name={iconName} size="lg" />
                  ) : (
                    <span className={styles.emojiIcon}>{action.ui.icon}</span>
                  )}
                </div>
                <span className={styles.actionName}>{action.ui.name}</span>
              </div>
              <span className={styles.actionDescription}>{action.ui.description}</span>
            </button>
          );
        })}
      </div>

      <div className={styles.footer}>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

export default ActionSelector;
