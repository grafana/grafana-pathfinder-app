import { error } from '../../lib/logger';
import React, { useState, ChangeEvent } from 'react';
import { Button, Field, Input, useStyles2, FieldSet, Switch, Text, Alert } from '@grafana/ui';
import { PluginConfigPageProps, AppPluginMeta, GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { testIds } from '../testIds';
import {
  DocsPluginConfig,
  DEFAULT_ENABLE_AUTO_DETECTION,
  DEFAULT_REQUIREMENTS_CHECK_TIMEOUT,
  DEFAULT_GUIDED_STEP_TIMEOUT,
} from '../../constants';
import { updatePluginSettings } from '../../utils/utils.plugin';

type JsonData = DocsPluginConfig;

type State = {
  enableAutoDetection: boolean;
  requirementsCheckTimeout: number;
  guidedStepTimeout: number;
};

export interface InteractiveFeaturesProps extends PluginConfigPageProps<AppPluginMeta<JsonData>> {}

const InteractiveFeatures = ({ plugin }: InteractiveFeaturesProps) => {
  const styles = useStyles2(getStyles);
  const { enabled, pinned, jsonData } = plugin.meta;

  // SINGLE SOURCE OF TRUTH: Initialize draft state ONCE from jsonData
  // After save, page reload brings fresh jsonData - no sync needed
  const [state, setState] = useState<State>(() => ({
    enableAutoDetection: jsonData?.enableAutoDetection ?? DEFAULT_ENABLE_AUTO_DETECTION,
    requirementsCheckTimeout: jsonData?.requirementsCheckTimeout ?? DEFAULT_REQUIREMENTS_CHECK_TIMEOUT,
    guidedStepTimeout: jsonData?.guidedStepTimeout ?? DEFAULT_GUIDED_STEP_TIMEOUT,
  }));
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const validateNumber = (value: string, min: number, max: number, fieldName: string): number | null => {
    const num = parseInt(value, 10);
    if (isNaN(num)) {
      setValidationErrors((prev) => ({ ...prev, [fieldName]: 'Must be a valid number' }));
      return null;
    }
    if (num < min || num > max) {
      setValidationErrors((prev) => ({ ...prev, [fieldName]: `Must be between ${min} and ${max}` }));
      return null;
    }
    setValidationErrors((prev) => {
      const newErrors = { ...prev };
      delete newErrors[fieldName];
      return newErrors;
    });
    return num;
  };

  const onToggleAutoDetection = (event: ChangeEvent<HTMLInputElement>) => {
    setState({ ...state, enableAutoDetection: event.target.checked });
  };

  const onChangeRequirementsTimeout = (event: ChangeEvent<HTMLInputElement>) => {
    const value = validateNumber(event.target.value, 1000, 10000, 'requirementsTimeout');
    if (value !== null) {
      setState({ ...state, requirementsCheckTimeout: value });
    }
  };

  const onChangeGuidedTimeout = (event: ChangeEvent<HTMLInputElement>) => {
    const value = validateNumber(event.target.value, 5000, 120000, 'guidedTimeout');
    if (value !== null) {
      setState({ ...state, guidedStepTimeout: value });
    }
  };

  const onResetDefaults = () => {
    setState({
      enableAutoDetection: DEFAULT_ENABLE_AUTO_DETECTION,
      requirementsCheckTimeout: DEFAULT_REQUIREMENTS_CHECK_TIMEOUT,
      guidedStepTimeout: DEFAULT_GUIDED_STEP_TIMEOUT,
    });
    setValidationErrors({});
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    // Check for validation errors
    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    setIsSaving(true);

    try {
      const newJsonData = {
        ...jsonData,
        enableAutoDetection: state.enableAutoDetection,
        requirementsCheckTimeout: state.requirementsCheckTimeout,
        guidedStepTimeout: state.guidedStepTimeout,
      };

      await updatePluginSettings(plugin.meta.id, {
        enabled,
        pinned,
        jsonData: newJsonData,
      });

      // Reload page to apply new settings
      setTimeout(() => {
        try {
          window.location.reload();
        } catch (e) {
          error('Failed to reload page after saving settings', e);
        }
      }, 100);

      setIsSaving(false);
    } catch (err) {
      error('Error saving Interactive Features:', err);
      setIsSaving(false);
      throw error;
    }
  };

  const hasChanges =
    state.enableAutoDetection !== (jsonData?.enableAutoDetection ?? DEFAULT_ENABLE_AUTO_DETECTION) ||
    state.requirementsCheckTimeout !== (jsonData?.requirementsCheckTimeout ?? DEFAULT_REQUIREMENTS_CHECK_TIMEOUT) ||
    state.guidedStepTimeout !== (jsonData?.guidedStepTimeout ?? DEFAULT_GUIDED_STEP_TIMEOUT);

  return (
    <form onSubmit={onSubmit}>
      <FieldSet label="Interactive guide features" className={styles.fieldSet}>
        <Alert
          title="Experimental feature"
          severity={state.enableAutoDetection ? 'info' : 'warning'}
          className={styles.alert}
        >
          {state.enableAutoDetection
            ? 'Auto-completion detection is enabled. Tutorial steps will automatically complete when you perform actions yourself.'
            : 'Auto-completion detection is disabled. You must click "Do it" buttons to complete tutorial steps.'}
        </Alert>

        <div className={styles.section}>
          <Text variant="h4" weight="medium">
            Auto-completion detection
          </Text>
          <div className={styles.toggleSection}>
            <Switch
              data-testid={testIds.appConfig.interactiveFeatures.toggle}
              id="enable-auto-detection"
              value={state.enableAutoDetection}
              onChange={onToggleAutoDetection}
            />
            <div className={styles.toggleLabels}>
              <Text variant="body" weight="medium">
                Enable automatic step completion
              </Text>
              <Text variant="body" color="secondary">
                Automatically mark tutorial steps as complete when you perform actions yourself (without clicking
                &quot;Do it&quot; buttons)
              </Text>
            </div>
          </div>

          {state.enableAutoDetection && (
            <Alert severity="info" title="How it works" className={styles.infoAlert}>
              <Text variant="body">
                When enabled, the system detects your actions and completes tutorial steps automatically for a more
                natural learning experience. Steps will still verify requirements before completion.
              </Text>
            </Alert>
          )}
        </div>

        <div className={styles.divider} />

        <div className={styles.section}>
          <Text variant="h4" weight="medium">
            Advanced settings
          </Text>
          <div className={styles.sectionDescription}>
            <Text variant="body" color="secondary">
              Fine-tune timing parameters for interactive guide behavior
            </Text>
          </div>

          {/* Requirements Check Timeout */}
          <Field
            label="Requirements check timeout"
            description="Maximum time to wait for requirement validation. Range: 1000-10000ms"
            invalid={!!validationErrors.requirementsTimeout}
            error={validationErrors.requirementsTimeout}
            className={styles.field}
          >
            <Input
              type="number"
              width={20}
              id="requirements-check-timeout"
              data-testid={testIds.appConfig.interactiveFeatures.requirementsTimeout}
              value={state.requirementsCheckTimeout}
              onChange={onChangeRequirementsTimeout}
              suffix="ms"
              min={1000}
              max={10000}
            />
          </Field>

          {/* Guided Step Timeout */}
          <Field
            label="Guided step timeout"
            description="Maximum time to wait for user to complete guided steps. Range: 5000-120000ms (5s-2min)"
            invalid={!!validationErrors.guidedTimeout}
            error={validationErrors.guidedTimeout}
            className={styles.field}
          >
            <Input
              type="number"
              width={20}
              id="guided-step-timeout"
              data-testid={testIds.appConfig.interactiveFeatures.guidedTimeout}
              value={state.guidedStepTimeout}
              onChange={onChangeGuidedTimeout}
              suffix="ms"
              min={5000}
              max={120000}
            />
          </Field>
        </div>

        <div className={styles.buttonGroup}>
          <Button
            type="button"
            variant="secondary"
            onClick={onResetDefaults}
            data-testid={testIds.appConfig.interactiveFeatures.reset}
            disabled={isSaving}
          >
            Reset to defaults
          </Button>
          <Button
            type="submit"
            data-testid={testIds.appConfig.interactiveFeatures.submit}
            disabled={isSaving || Object.keys(validationErrors).length > 0 || !hasChanges}
          >
            {isSaving ? 'Saving...' : 'Save configuration'}
          </Button>
        </div>
      </FieldSet>
    </form>
  );
};

export default InteractiveFeatures;

const getStyles = (theme: GrafanaTheme2) => ({
  fieldSet: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(3),
  }),
  alert: css({
    marginBottom: theme.spacing(2),
  }),
  section: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
  }),
  sectionDescription: css({
    marginBottom: theme.spacing(1),
  }),
  toggleSection: css({
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(2),
    marginTop: theme.spacing(1),
  }),
  toggleLabels: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    flex: 1,
  }),
  infoAlert: css({
    marginTop: theme.spacing(2),
  }),
  divider: css({
    borderTop: `1px solid ${theme.colors.border.weak}`,
    margin: `${theme.spacing(2)} 0`,
  }),
  field: css({
    marginTop: theme.spacing(2),
  }),
  buttonGroup: css({
    display: 'flex',
    gap: theme.spacing(2),
    marginTop: theme.spacing(2),
  }),
});
