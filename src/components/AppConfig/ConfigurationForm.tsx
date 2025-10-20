import React, { useState, ChangeEvent } from 'react';
import { Button, Field, Input, useStyles2, FieldSet, Switch, Alert, Text, Badge } from '@grafana/ui';
import { PluginConfigPageProps, AppPluginMeta, GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { testIds } from '../testIds';
import {
  DocsPluginConfig,
  DEFAULT_RECOMMENDER_SERVICE_URL,
  DEFAULT_TUTORIAL_URL,
  DEFAULT_INTERCEPT_GLOBAL_DOCS_LINKS,
} from '../../constants';
import { updatePluginSettings } from '../../utils/utils.plugin';
import { isDevModeEnabled, toggleDevMode } from '../../utils/dev-mode';
import { config } from '@grafana/runtime';

type JsonData = DocsPluginConfig;

type State = {
  // The URL to reach the recommender service
  recommenderServiceUrl: string;
  // Auto-launch tutorial URL (for demo scenarios)
  tutorialUrl: string;
  // Global link interception
  interceptGlobalDocsLinks: boolean;
};

export interface ConfigurationFormProps extends PluginConfigPageProps<AppPluginMeta<JsonData>> {}

const ConfigurationForm = ({ plugin }: ConfigurationFormProps) => {
  const urlParams = new URLSearchParams(window.location.search);
  const hasDevParam = urlParams.get('dev') === 'true';
  const s = useStyles2(getStyles);
  const { enabled, pinned, jsonData } = plugin.meta;
  const [state, setState] = useState<State>({
    recommenderServiceUrl: jsonData?.recommenderServiceUrl || DEFAULT_RECOMMENDER_SERVICE_URL,
    tutorialUrl: jsonData?.tutorialUrl || DEFAULT_TUTORIAL_URL,
    interceptGlobalDocsLinks: jsonData?.interceptGlobalDocsLinks ?? DEFAULT_INTERCEPT_GLOBAL_DOCS_LINKS,
  });
  const [isSaving, setIsSaving] = useState(false);

  // SECURITY: Dev mode - hybrid approach (jsonData storage, multi-user ID scoping)
  // Get current user ID for scoping
  const currentUserId = config.bootData.user?.id;
  const devModeUserIds = jsonData?.devModeUserIds ?? [];

  // Check if dev mode is enabled for THIS user (synchronous)
  const devModeEnabledForUser = isDevModeEnabled(jsonData || {}, currentUserId);
  const [devModeToggling, setDevModeToggling] = useState<boolean>(false);

  // Show dev mode input if URL param is set OR if dev mode is already enabled for this user
  const showDevModeInput = hasDevParam || devModeEnabledForUser;

  // Show advanced config fields only in dev mode (for Grafana team development)
  const showAdvancedConfig = devModeEnabledForUser || showDevModeInput;

  // Configuration is now retrieved directly from plugin meta via usePluginContext

  // Only require service URLs when in dev mode, otherwise these are hidden
  const isSubmitDisabled = showAdvancedConfig ? Boolean(!state.recommenderServiceUrl) : false;

  const onChangeRecommenderServiceUrl = (event: ChangeEvent<HTMLInputElement>) => {
    setState({
      ...state,
      recommenderServiceUrl: event.target.value.trim(),
    });
  };

  const onChangeTutorialUrl = (event: ChangeEvent<HTMLInputElement>) => {
    setState({
      ...state,
      tutorialUrl: event.target.value.trim(),
    });
  };

  const onChangeDevMode = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!currentUserId) {
      alert('Cannot determine current user. Please refresh the page and try again.');
      return;
    }

    // SECURITY: Dev mode is now stored in plugin jsonData (server-side, admin-controlled)
    setDevModeToggling(true);
    try {
      await toggleDevMode(currentUserId, devModeEnabledForUser, devModeUserIds);

      // Reload page to refresh plugin config and apply changes globally
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (error) {
      console.error('Failed to toggle dev mode:', error);

      // Show user-friendly error message
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to toggle dev mode. You may need admin permissions.';
      alert(errorMessage);

      setDevModeToggling(false);
    }
  };

  const onToggleGlobalLinkInterception = (event: ChangeEvent<HTMLInputElement>) => {
    setState({
      ...state,
      interceptGlobalDocsLinks: event.target.checked,
    });
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);

    try {
      const newJsonData = {
        ...jsonData, // Preserve existing fields
        recommenderServiceUrl: state.recommenderServiceUrl,
        tutorialUrl: state.tutorialUrl,
        interceptGlobalDocsLinks: state.interceptGlobalDocsLinks,
      };

      await updatePluginSettings(plugin.meta.id, {
        enabled,
        pinned,
        jsonData: newJsonData,
      });

      // As a fallback, perform a hard reload so plugin context jsonData is guaranteed fresh
      setTimeout(() => {
        try {
          window.location.reload();
        } catch (e) {
          console.error('Failed to reload page after saving configuration', e);
        }
      }, 100);
    } catch (error) {
      console.error('Error saving configuration:', error);
      setIsSaving(false);
      // Re-throw to let user know something went wrong
      throw error;
    }
  };

  return (
    <form onSubmit={onSubmit}>
      <FieldSet label="Plugin Configuration" className={s.marginTopXl}>
        {/* Advanced configuration fields - only shown in dev mode */}
        {showAdvancedConfig && (
          <>
            {/* Recommender Service URL */}
            <Field
              label="Recommender service URL"
              description="The URL of the service that provides documentation recommendations (Dev mode only)"
            >
              <Input
                width={60}
                id="recommender-service-url"
                data-testid={testIds.appConfig.recommenderServiceUrl}
                value={state.recommenderServiceUrl}
                placeholder={DEFAULT_RECOMMENDER_SERVICE_URL}
                onChange={onChangeRecommenderServiceUrl}
              />
            </Field>
          </>
        )}

        {/* Tutorial URL - available to all users */}
        <Field
          label="Auto-launch tutorial URL"
          description="Optional: URL of a learning journey or documentation page to automatically open when Grafana starts. Useful for demo scenarios. Can be set via environment variable GF_PLUGINS_GRAFANA_PATHFINDER_APP_TUTORIAL_URL"
          className={s.marginTop}
        >
          <Input
            width={60}
            id="tutorial-url"
            data-testid={testIds.appConfig.tutorialUrl}
            value={state.tutorialUrl}
            placeholder="https://grafana.com/docs/learning-journeys/..."
            onChange={onChangeTutorialUrl}
          />
        </Field>

        {/* Dev Mode - Per-User Setting (stored server-side in Grafana user preferences) */}
        {showDevModeInput && (
          <>
            <Field
              label="Dev Mode"
              description="⚠️ WARNING: Disables security protections. Only enable in isolated development environments. Requires admin permissions to change. Only visible to the user who enabled it."
              className={s.marginTop}
            >
              <div className={s.devModeField}>
                <Input
                  type="checkbox"
                  id="dev-mode"
                  checked={devModeEnabledForUser}
                  onChange={onChangeDevMode}
                  disabled={devModeToggling}
                />
                {devModeToggling && <span className={s.updateText}>Saving to server and reloading...</span>}
              </div>
            </Field>
            {devModeEnabledForUser && (
              <Alert severity="warning" title="⚠️ Dev mode security warning" className={s.marginTop}>
                <Text variant="body" weight="bold">
                  Dev mode disables critical security protections:
                </Text>
                <ul style={{ marginTop: '8px', marginBottom: '8px' }}>
                  <li>Allows loading content from ANY GitHub repository (bypasses branch validation)</li>
                  <li>Allows loading content from ANY localhost URL</li>
                  <li>Exposes debug tools that can manipulate the Grafana DOM</li>
                  <li>Bypasses source validation for interactive content</li>
                </ul>
                <Text variant="body" weight="bold" color="error">
                  Only enable dev mode in isolated development environments. Never enable when viewing untrusted content
                  or in production.
                </Text>
              </Alert>
            )}
          </>
        )}

        {/* Global Link Interception */}
        <FieldSet
          label={
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              Global Link Interception
              <Badge text="Experimental" color="orange" />
            </div>
          }
          className={s.marginTopXl}
        >
          <div className={s.toggleSection}>
            <Switch
              id="enable-global-link-interception"
              value={state.interceptGlobalDocsLinks}
              onChange={onToggleGlobalLinkInterception}
            />
            <div className={s.toggleLabels}>
              <Text variant="body" weight="medium">
                Intercept documentation links globally
              </Text>
              <Text variant="body" color="secondary">
                When enabled, clicking Grafana docs links anywhere will open them in Pathfinder instead of a new tab
              </Text>
            </div>
          </div>

          {state.interceptGlobalDocsLinks && (
            <Alert severity="info" title="How it works" className={s.marginTop}>
              <Text variant="body">
                When you click a documentation link anywhere in Grafana, Pathfinder will automatically open the sidebar
                (if closed) and display the documentation inside. Links are queued if the sidebar hasn&apos;t fully
                loaded yet.
                <br />
                <br />
                Hold <strong>Ctrl</strong> (Windows/Linux) or <strong>Cmd</strong> (Mac) while clicking any link to open
                it in a new tab instead of Pathfinder. Middle-click also opens in a new tab.
              </Text>
            </Alert>
          )}
        </FieldSet>

        <div className={s.marginTop}>
          <Button type="submit" data-testid={testIds.appConfig.submit} disabled={isSubmitDisabled || isSaving}>
            {isSaving ? 'Saving...' : 'Save configuration'}
          </Button>
        </div>
      </FieldSet>
    </form>
  );
};

export default ConfigurationForm;

const getStyles = (theme: GrafanaTheme2) => ({
  colorWeak: css`
    color: ${theme.colors.text.secondary};
  `,
  marginTop: css`
    margin-top: ${theme.spacing(3)};
  `,
  marginTopXl: css`
    margin-top: ${theme.spacing(6)};
  `,
  toggleSection: css`
    display: flex;
    align-items: flex-start;
    gap: ${theme.spacing(2)};
    margin-bottom: ${theme.spacing(2)};
  `,
  toggleLabels: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(0.5)};
    flex: 1;
  `,
  devModeField: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
  `,
  updateText: css`
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  marginTopSmall: css`
    margin-top: ${theme.spacing(1)};
  `,
});
