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
  DEFAULT_ENABLE_LIVE_SESSIONS,
  DEFAULT_PEERJS_HOST,
  DEFAULT_PEERJS_PORT,
  DEFAULT_PEERJS_KEY,
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
  // Live sessions (collaborative learning)
  enableLiveSessions: boolean;
  peerjsHost: string;
  peerjsPort: number;
  peerjsKey: string;
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
    enableLiveSessions: jsonData?.enableLiveSessions ?? DEFAULT_ENABLE_LIVE_SESSIONS,
    peerjsHost: jsonData?.peerjsHost || DEFAULT_PEERJS_HOST,
    peerjsPort: jsonData?.peerjsPort ?? DEFAULT_PEERJS_PORT,
    peerjsKey: jsonData?.peerjsKey || DEFAULT_PEERJS_KEY,
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

  const onToggleLiveSessions = (event: ChangeEvent<HTMLInputElement>) => {
    setState({
      ...state,
      enableLiveSessions: event.target.checked,
    });
  };

  const onChangePeerjsHost = (event: ChangeEvent<HTMLInputElement>) => {
    setState({
      ...state,
      peerjsHost: event.target.value.trim(),
    });
  };

  const onChangePeerjsPort = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value.trim();
    const port = value === '' ? DEFAULT_PEERJS_PORT : parseInt(value, 10);
    setState({
      ...state,
      peerjsPort: isNaN(port) ? DEFAULT_PEERJS_PORT : port,
    });
  };

  const onChangePeerjsKey = (event: ChangeEvent<HTMLInputElement>) => {
    setState({
      ...state,
      peerjsKey: event.target.value.trim(),
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
        enableLiveSessions: state.enableLiveSessions,
        peerjsHost: state.peerjsHost,
        peerjsPort: state.peerjsPort,
        peerjsKey: state.peerjsKey,
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
          description="Optional: URL of a learning journey or documentation page to automatically open when Grafana starts. Useful for demo scenarios. Can be set via environment variable GF_PLUGINS_GRAFANA_GRAFANADOCSPLUGIN_APP_TUTORIAL_URL"
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

        {/* Live Sessions (Collaborative Learning) - EXPERIMENTAL */}
        <FieldSet label="Live Sessions (Collaborative Learning) — Experimental" className={s.marginTopXl}>
          <div className={s.toggleSection}>
            <Switch
              id="enable-live-sessions"
              value={state.enableLiveSessions}
              onChange={onToggleLiveSessions}
            />
            <div className={s.toggleLabels}>
              <Text variant="body" weight="medium">
                Enable live collaborative learning sessions (Experimental)
              </Text>
              <Text variant="body" color="secondary">
                Allow presenters to create live sessions where attendees can follow along with interactive tutorials in real-time
              </Text>
            </div>
          </div>

          {state.enableLiveSessions && (
            <>
              <Alert severity="warning" title="⚠️ Experimental Feature" className={s.marginTop}>
                <Text variant="body">
                  <strong>This feature is experimental and may have stability issues.</strong> Connection reliability depends on
                  network configuration and the availability of the PeerJS cloud service. Not recommended for production-critical workflows.
                </Text>
              </Alert>
              
              <Alert severity="info" title="How it works" className={s.marginTop}>
                <Text variant="body">
                  <strong>For Presenters:</strong> Click "Start Live Session" to create a session and share the join code with attendees.
                  When you click "Show Me" or "Do It" buttons, attendees will see the same highlights and actions on their screens.
                  <br />
                  <br />
                  <strong>For Attendees:</strong> Click "Join Live Session" and enter the join code from the presenter.
                  Choose between <strong>Guided Mode</strong> (see highlights only) or <strong>Follow Mode</strong> (actions execute automatically).
                </Text>
              </Alert>

              {/* PeerJS Server Configuration */}
              <div className={s.marginTop}>
                <Text variant="h6">Signaling Server Settings</Text>
                <div style={{ marginTop: '8px', marginBottom: '16px' }}>
                  <Text variant="body" color="secondary">
                    Configure the live session signaling server.
                  </Text>
                </div>

                <Field label="Server Host" description="Hostname or IP address">
                  <Input
                    value={state.peerjsHost}
                    onChange={onChangePeerjsHost}
                    placeholder={DEFAULT_PEERJS_HOST}
                  />
                </Field>

                <Field label="Server Port" description="Port number">
                  <Input
                    type="number"
                    value={state.peerjsPort}
                    onChange={onChangePeerjsPort}
                    placeholder={String(DEFAULT_PEERJS_PORT)}
                  />
                </Field>

                <Field label="API Key" description="Authentication key">
                  <Input
                    value={state.peerjsKey}
                    onChange={onChangePeerjsKey}
                    placeholder={DEFAULT_PEERJS_KEY}
                  />
                </Field>
              </div>
            </>
          )}

          {!state.enableLiveSessions && (
            <Alert severity="warning" title="Experimental feature disabled" className={s.marginTop}>
              <Text variant="body">
                Live sessions are currently disabled. This is an <strong>experimental feature</strong> that enables collaborative learning
                experiences where presenters can guide attendees through interactive tutorials in real-time.
                <br />
                <br />
                <strong>Note:</strong> This feature uses peer-to-peer connections and may have stability issues depending on network
                configuration. Enable only if you understand the limitations and have tested it in your environment.
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
