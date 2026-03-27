import React, { useState, ChangeEvent } from 'react';
import { Button, Field, Input, useStyles2, FieldSet, Switch, Text, Alert } from '@grafana/ui';
import { PluginConfigPageProps, AppPluginMeta, GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { testIds } from '../../constants/testIds';
import {
  DocsPluginConfig,
  DEFAULT_ENABLE_AUTO_DETECTION,
  DEFAULT_REQUIREMENTS_CHECK_TIMEOUT,
  DEFAULT_GUIDED_STEP_TIMEOUT,
  DEFAULT_DISABLE_AUTO_COLLAPSE,
  DEFAULT_ENABLE_KIOSK_MODE,
  DEFAULT_KIOSK_RULES_URL,
  DEFAULT_KIOSK_TARGET_URL,
} from '../../constants';
import { updatePluginSettings } from '../../utils/utils.plugin';

type JsonData = DocsPluginConfig;

type State = {
  enableAutoDetection: boolean;
  requirementsCheckTimeout: number;
  guidedStepTimeout: number;
  disableAutoCollapse: boolean;
  enableKioskMode: boolean;
  kioskRulesUrl: string;
  kioskTargetUrl: string;
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
    disableAutoCollapse: jsonData?.disableAutoCollapse ?? DEFAULT_DISABLE_AUTO_COLLAPSE,
    enableKioskMode: jsonData?.enableKioskMode ?? DEFAULT_ENABLE_KIOSK_MODE,
    kioskRulesUrl: jsonData?.kioskRulesUrl ?? DEFAULT_KIOSK_RULES_URL,
    kioskTargetUrl: jsonData?.kioskTargetUrl ?? DEFAULT_KIOSK_TARGET_URL,
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

  const onToggleDisableAutoCollapse = (event: ChangeEvent<HTMLInputElement>) => {
    setState({ ...state, disableAutoCollapse: event.target.checked });
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

  const onToggleKioskMode = (event: ChangeEvent<HTMLInputElement>) => {
    setState({ ...state, enableKioskMode: event.target.checked });
  };

  const onChangeKioskRulesUrl = (event: ChangeEvent<HTMLInputElement>) => {
    setState({ ...state, kioskRulesUrl: event.target.value.trim() });
  };

  const onChangeKioskTargetUrl = (event: ChangeEvent<HTMLInputElement>) => {
    setState({ ...state, kioskTargetUrl: event.target.value.trim() });
  };

  const onResetDefaults = () => {
    setState({
      enableAutoDetection: DEFAULT_ENABLE_AUTO_DETECTION,
      requirementsCheckTimeout: DEFAULT_REQUIREMENTS_CHECK_TIMEOUT,
      guidedStepTimeout: DEFAULT_GUIDED_STEP_TIMEOUT,
      disableAutoCollapse: DEFAULT_DISABLE_AUTO_COLLAPSE,
      enableKioskMode: DEFAULT_ENABLE_KIOSK_MODE,
      kioskRulesUrl: DEFAULT_KIOSK_RULES_URL,
      kioskTargetUrl: DEFAULT_KIOSK_TARGET_URL,
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
        disableAutoCollapse: state.disableAutoCollapse,
        enableKioskMode: state.enableKioskMode,
        kioskRulesUrl: state.kioskRulesUrl,
        kioskTargetUrl: state.kioskTargetUrl,
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
          console.error('Failed to reload page after saving settings', e);
        }
      }, 100);

      setIsSaving(false);
    } catch (error) {
      console.error('Error saving Interactive Features:', error);
      setIsSaving(false);
      throw error;
    }
  };

  const hasChanges =
    state.enableAutoDetection !== (jsonData?.enableAutoDetection ?? DEFAULT_ENABLE_AUTO_DETECTION) ||
    state.requirementsCheckTimeout !== (jsonData?.requirementsCheckTimeout ?? DEFAULT_REQUIREMENTS_CHECK_TIMEOUT) ||
    state.guidedStepTimeout !== (jsonData?.guidedStepTimeout ?? DEFAULT_GUIDED_STEP_TIMEOUT) ||
    state.disableAutoCollapse !== (jsonData?.disableAutoCollapse ?? DEFAULT_DISABLE_AUTO_COLLAPSE) ||
    state.enableKioskMode !== (jsonData?.enableKioskMode ?? DEFAULT_ENABLE_KIOSK_MODE) ||
    state.kioskRulesUrl !== (jsonData?.kioskRulesUrl ?? DEFAULT_KIOSK_RULES_URL) ||
    state.kioskTargetUrl !== (jsonData?.kioskTargetUrl ?? DEFAULT_KIOSK_TARGET_URL);

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
            Section collapse behavior
          </Text>
          <div className={styles.toggleSection}>
            <Switch
              data-testid={testIds.appConfig.interactiveFeatures.disableAutoCollapse}
              id="disable-auto-collapse"
              value={state.disableAutoCollapse}
              onChange={onToggleDisableAutoCollapse}
            />
            <div className={styles.toggleLabels}>
              <Text variant="body" weight="medium">
                Disable auto-collapse on section completion
              </Text>
              <Text variant="body" color="secondary">
                When enabled, completed sections remain expanded. You can still collapse them manually using the toggle
                button.
              </Text>
            </div>
          </div>
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

        <div className={styles.divider} />

        <div className={styles.section}>
          <Text variant="h4" weight="medium">
            Kiosk mode
          </Text>
          <div className={styles.toggleSection}>
            <Switch id="enable-kiosk-mode" value={state.enableKioskMode} onChange={onToggleKioskMode} />
            <div className={styles.toggleLabels}>
              <Text variant="body" weight="medium">
                Enable kiosk mode
              </Text>
              <Text variant="body" color="secondary">
                Show a full-screen guide catalog overlay. Requires dev mode to be enabled.
              </Text>
            </div>
          </div>

          {state.enableKioskMode && (
            <>
              <Field label="Rules JSON URL" description="URL to a JSON file containing guide rules (optional)">
                <Input
                  id="kiosk-rules-url"
                  value={state.kioskRulesUrl}
                  onChange={onChangeKioskRulesUrl}
                  placeholder="https://example.com/kiosk-rules.json"
                />
              </Field>

              <Field
                label="Target Grafana URL"
                description="Base URL of the Grafana instance to open guides in (e.g. https://play.grafana.org)"
              >
                <Input
                  id="kiosk-target-url"
                  value={state.kioskTargetUrl}
                  onChange={onChangeKioskTargetUrl}
                  placeholder="https://play.grafana.org"
                />
              </Field>
            </>
          )}
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
