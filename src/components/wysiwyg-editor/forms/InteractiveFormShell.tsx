import React from 'react';
import { Button, Stack, Alert, HorizontalGroup, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { COMMON_REQUIREMENTS } from '../../../constants/interactive-config';

interface InteractiveFormShellProps {
  title: string;
  description: string;
  infoBox?: string;
  children: React.ReactNode;
  onCancel: () => void;
  onSwitchType?: () => void;
  initialValues?: Record<string, any>;
  isValid?: boolean;
  onApply: () => void;
  commonRequirementsSlot?: React.ReactNode;
}

const getShellStyles = (theme: GrafanaTheme2) => ({
  wrapper: css({
    padding: theme.spacing(2),
  }),
  title: css({
    marginBottom: theme.spacing(1),
    marginTop: 0,
  }),
  description: css({
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing(2),
    marginTop: 0,
  }),
  actions: css({
    marginTop: theme.spacing(2),
  }),
});

/**
 * Shared form shell component that provides consistent layout and styling
 * for all interactive action forms. Uses Grafana UI primitives to minimize
 * custom CSS and leverage theme inheritance.
 */
export const InteractiveFormShell: React.FC<InteractiveFormShellProps> = ({
  title,
  description,
  infoBox,
  children,
  onCancel,
  onSwitchType,
  initialValues,
  isValid = true,
  onApply,
  commonRequirementsSlot,
}) => {
  const styles = useStyles2(getShellStyles);

  return (
    <div data-wysiwyg-form="true" className={styles.wrapper}>
      <h4 className={styles.title}>{title}</h4>
      <p className={styles.description}>{description}</p>

      <Stack direction="column" gap={2}>
        {children}
        {commonRequirementsSlot}
      </Stack>

      {infoBox && (
        <Alert title="Note" severity="info" style={{ marginTop: '16px', marginBottom: '16px' }}>
          {infoBox}
        </Alert>
      )}

      <HorizontalGroup justify="flex-end" spacing="sm" className={styles.actions}>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        {initialValues && onSwitchType && (
          <Button variant="secondary" onClick={onSwitchType}>
            Switch Type
          </Button>
        )}
        <Button variant="primary" onClick={onApply} disabled={!isValid}>
          Apply
        </Button>
      </HorizontalGroup>
    </div>
  );
};

/**
 * Helper component for rendering common requirements buttons
 */
export const CommonRequirementsButtons: React.FC<{
  onSelect: (requirement: string) => void;
}> = ({ onSelect }) => {
  return (
    <HorizontalGroup spacing="sm" wrap>
      {COMMON_REQUIREMENTS.slice(0, 3).map((req) => (
        <Button key={req} size="sm" variant="secondary" onClick={() => onSelect(req)}>
          {req}
        </Button>
      ))}
    </HorizontalGroup>
  );
};
