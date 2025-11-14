import React from 'react';
import { Button, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { getSelectableActions } from './actionRegistry';

interface ActionSelectorProps {
  onSelect: (actionType: string) => void;
  onCancel: () => void;
}

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    padding: theme.spacing(2),
  }),
  title: css({
    marginBottom: theme.spacing(1),
  }),
  description: css({
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing(2),
  }),
  grid: css({
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    gap: theme.spacing(2),
    marginBottom: theme.spacing(2),
  }),
  actionWrapper: css({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  actionButton: css({
    height: 'auto',
    padding: theme.spacing(2),
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.spacing(1),
    textAlign: 'center',
    width: '100%',
  }),
  actionIcon: css({
    fontSize: '24px',
  }),
  actionName: css({
    fontWeight: theme.typography.fontWeightMedium,
  }),
  actionDesc: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    textAlign: 'center',
    marginTop: theme.spacing(0.5),
  }),
  actions: css({
    display: 'flex',
    justifyContent: 'flex-end',
  }),
});

/**
 * Component for selecting an interactive action type
 * Uses centralized action metadata and Grafana UI components
 * 
 * Note: Sequence action type is hidden from this selector because it's
 * handled by the "Add Section" button in the toolbar. Sequence sections
 * can still be edited via the edit flow (which doesn't use this selector).
 */
const ActionSelector = ({ onSelect, onCancel }: ActionSelectorProps) => {
  const styles = useStyles2(getStyles);

  // Get selectable actions (excludes hidden ones like SEQUENCE)
  const selectableActions = getSelectableActions();

  return (
    <div className={styles.container}>
      <p className={styles.description}>Choose the type of interaction for this element</p>
      <div className={styles.grid}>
        {selectableActions.map((action) => (
          <div key={action.type} className={styles.actionWrapper}>
            <Button variant="secondary" onClick={() => onSelect(action.type)} className={styles.actionButton}>
              <span className={styles.actionIcon}>{action.ui.icon}</span>
              <span className={styles.actionName}>{action.ui.name}</span>
            </Button>
            <span className={styles.actionDesc}>{action.ui.description}</span>
          </div>
        ))}
      </div>
      <div className={styles.actions}>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

export default ActionSelector;
