import React from 'react';
import { Button, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { ACTION_METADATA } from '../../../constants/interactive-config';

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
  actionButton: css({
    height: 'auto',
    padding: theme.spacing(2),
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.spacing(1),
    textAlign: 'center',
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
  }),
  actions: css({
    display: 'flex',
    justifyContent: 'flex-end',
  }),
});

/**
 * Component for selecting an interactive action type
 * Uses centralized action metadata and Grafana UI components
 */
const ActionSelector = ({ onSelect, onCancel }: ActionSelectorProps) => {
  const styles = useStyles2(getStyles);

  return (
    <div className={styles.container}>
      <h4 className={styles.title}>Select Interactive Action</h4>
      <p className={styles.description}>Choose the type of interaction for this element</p>
      <div className={styles.grid}>
        {ACTION_METADATA.map((option) => (
          <Button
            key={option.type}
            variant="secondary"
            onClick={() => onSelect(option.type)}
            className={styles.actionButton}
          >
            <span className={styles.actionIcon}>{option.icon}</span>
            <span className={styles.actionName}>{option.name}</span>
            <span className={styles.actionDesc}>{option.description}</span>
          </Button>
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

