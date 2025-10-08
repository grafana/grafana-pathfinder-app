import React, { useState, ChangeEvent } from 'react';
import { Button, Field, Input, useStyles2, FieldSet, SecretInput, Switch, Alert, Text } from '@grafana/ui';
import { PluginConfigPageProps, AppPluginMeta, GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { testIds } from '../testIds';
import {
  DocsPluginConfig,
  DEFAULT_RECOMMENDER_SERVICE_URL,
  DEFAULT_DOCS_BASE_URL,
  DEFAULT_DOCS_USERNAME,
  DEFAULT_TUTORIAL_URL,
  DEFAULT_INTERCEPT_GLOBAL_DOCS_LINKS,
} from '../../constants';
import { updatePluginSettings } from '../../utils/utils.plugin';

type JsonData = DocsPluginConfig;

type State = {
  // The URL to reach the recommender service
  recommenderServiceUrl: string;
  // The base URL for the docs website service
  docsBaseUrl: string;
  // Username for docs authentication
  docsUsername: string;
  // Password for docs authentication
  docsPassword: string;
  // Tells us if the docs password secret is set (from secureJsonFields)
  isDocsPasswordSet: boolean;
  // Auto-launch tutorial URL (for demo scenarios)
  tutorialUrl: string;
  // Dev mode enables loading of the components page for testing of proper rendering of components
  devMode: boolean;
  // Global link interception
  interceptGlobalDocsLinks: boolean;
};

export interface ConfigurationFormProps extends PluginConfigPageProps<AppPluginMeta<JsonData>> {}

const ConfigurationForm = ({ plugin }: ConfigurationFormProps) => {
  const urlParams = new URLSearchParams(window.location.search);
  const showDevModeInput = urlParams.get('dev') === 'true';
  const s = useStyles2(getStyles);
  const { enabled, pinned, jsonData, secureJsonFields } = plugin.meta;
  const [state, setState] = useState<State>({
    recommenderServiceUrl: jsonData?.recommenderServiceUrl || DEFAULT_RECOMMENDER_SERVICE_URL,
    docsBaseUrl: jsonData?.docsBaseUrl || DEFAULT_DOCS_BASE_URL,
    docsUsername: jsonData?.docsUsername || DEFAULT_DOCS_USERNAME,
    docsPassword: '',
    isDocsPasswordSet: Boolean(secureJsonFields && (secureJsonFields as any).docsPassword),
    tutorialUrl: jsonData?.tutorialUrl || DEFAULT_TUTORIAL_URL,
    devMode: jsonData?.devMode || false,
    interceptGlobalDocsLinks: jsonData?.interceptGlobalDocsLinks ?? DEFAULT_INTERCEPT_GLOBAL_DOCS_LINKS,
  });
  const [isSaving, setIsSaving] = useState(false);

  // Configuration is now retrieved directly from plugin meta via usePluginContext

  const isSubmitDisabled = Boolean(!state.recommenderServiceUrl || !state.docsBaseUrl);

  const onResetDocsPassword = () =>
    setState({
      ...state,
      docsPassword: '',
      isDocsPasswordSet: false,
    });

  const onChangeDocsPassword = (event: ChangeEvent<HTMLInputElement>) => {
    setState({
      ...state,
      docsPassword: event.target.value.trim(),
    });
  };

  const onChangeRecommenderServiceUrl = (event: ChangeEvent<HTMLInputElement>) => {
    setState({
      ...state,
      recommenderServiceUrl: event.target.value.trim(),
    });
  };

  const onChangeDocsBaseUrl = (event: ChangeEvent<HTMLInputElement>) => {
    setState({
      ...state,
      docsBaseUrl: event.target.value.trim(),
    });
  };

  const onChangeDocsUsername = (event: ChangeEvent<HTMLInputElement>) => {
    setState({
      ...state,
      docsUsername: event.target.value.trim(),
    });
  };

  const onChangeTutorialUrl = (event: ChangeEvent<HTMLInputElement>) => {
    setState({
      ...state,
      tutorialUrl: event.target.value.trim(),
    });
  };

  const onChangeDevMode = (event: ChangeEvent<HTMLInputElement>) => {
    setState({
      ...state,
      devMode: event.target.checked,
    });
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
        docsBaseUrl: state.docsBaseUrl,
        docsUsername: state.docsUsername,
        tutorialUrl: state.tutorialUrl,
        devMode: state.devMode,
        interceptGlobalDocsLinks: state.interceptGlobalDocsLinks,
      };

      await updatePluginSettings(plugin.meta.id, {
        enabled,
        pinned,
        jsonData: newJsonData,
        // Only include secureJsonData if password was changed
        secureJsonData: state.isDocsPasswordSet ? undefined : { docsPassword: state.docsPassword },
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
        {/* Recommender Service URL */}
        <Field
          label="Recommender service URL"
          description="The URL of the service that provides documentation recommendations"
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

        {/* Docs Base website URL */}
        <Field label="Docs base URL" description="The base URL for the documentation service" className={s.marginTop}>
          <Input
            width={60}
            id="docs-base-url"
            data-testid={testIds.appConfig.docsBaseUrl}
            value={state.docsBaseUrl}
            placeholder={DEFAULT_DOCS_BASE_URL}
            onChange={onChangeDocsBaseUrl}
          />
        </Field>

        {/* Docs Username */}
        <Field
          label="Docs username"
          description="Username for accessing the documentation service (if authentication is required)"
          className={s.marginTop}
        >
          <Input
            width={60}
            id="docs-username"
            data-testid={testIds.appConfig.docsUsername}
            value={state.docsUsername}
            placeholder="Enter username (optional)"
            onChange={onChangeDocsUsername}
          />
        </Field>

        {/* Docs Password */}
        <Field
          label="Docs password"
          description="Password for accessing the documentation service (if authentication is required)"
          className={s.marginTop}
        >
          <SecretInput
            width={60}
            data-testid={testIds.appConfig.docsPassword}
            id="docs-password"
            value={state.docsPassword}
            isConfigured={state.isDocsPasswordSet}
            placeholder="Enter password (optional)"
            onChange={onChangeDocsPassword}
            onReset={onResetDocsPassword}
          />
        </Field>

        {/* Tutorial URL */}
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

        {/* Dev Mode */}
        {showDevModeInput && (
          <Field label="Dev Mode" description="Enable dev mode" className={s.marginTop}>
            <Input type="checkbox" id="dev-mode" checked={state.devMode} onChange={onChangeDevMode} />
          </Field>
        )}

        {/* Global Link Interception */}
        <FieldSet label="Global Link Interception" className={s.marginTopXl}>
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
            <Alert severity="info" title="Important" className={s.marginTop}>
              <Text variant="body">
                <strong>The Pathfinder sidebar must be open</strong> for link interception to work. Once enabled, open
                the sidebar and keep it open while browsing Grafana.
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
});
