import React, { useState, ChangeEvent } from 'react';
import { Button, Field, Input, useStyles2, FieldSet, Switch, Alert, Text, Badge } from '@grafana/ui';
import { PluginConfigPageProps, AppPluginMeta, GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { testIds } from '../../constants/testIds';
import {
  PathfinderPluginConfig,
  DEFAULT_TUTORIAL_URL,
  DEFAULT_INTERCEPT_GLOBAL_DOCS_LINKS,
  DEFAULT_OPEN_PANEL_ON_LAUNCH,
  DEFAULT_ENABLE_LIVE_SESSIONS,
  DEFAULT_PEERJS_HOST,
  DEFAULT_PEERJS_PORT,
  DEFAULT_PEERJS_KEY,
  DEFAULT_PEERJS_SECURE,
  DEFAULT_ENABLE_CODA_TERMINAL,
  TENANT_SETTING_BOUNDS,
  ResolvedPathfinderConfig,
  getDefaultRecommenderUrl,
  isKnownRecommenderUrl,
} from '../../constants';
import { saveTenantSettings } from './save-settings';
import { useSeededDraft } from './use-seeded-draft';
import { isDevModeEnabled, toggleDevMode } from '../../utils/dev-mode';
import { logger } from '../../lib/logging';
import { CodaBackendStatus } from './CodaBackendStatus';

type JsonData = PathfinderPluginConfig;

type State = {
  recommenderServiceUrl: string;
  tutorialUrl: string;
  interceptGlobalDocsLinks: boolean;
  openPanelOnLaunch: boolean;
  enableLiveSessions: boolean;
  peerjsHost: string;
  peerjsPort: number;
  peerjsKey: string;
  peerjsSecure: boolean;
  enableCodaTerminal: boolean;
};

function buildStateFromConfig(config: ResolvedPathfinderConfig): State {
  return {
    recommenderServiceUrl:
      config.recommenderServiceUrl && !isKnownRecommenderUrl(config.recommenderServiceUrl)
        ? config.recommenderServiceUrl
        : getDefaultRecommenderUrl(),
    tutorialUrl: config.tutorialUrl || DEFAULT_TUTORIAL_URL,
    interceptGlobalDocsLinks: config.interceptGlobalDocsLinks ?? DEFAULT_INTERCEPT_GLOBAL_DOCS_LINKS,
    openPanelOnLaunch: config.openPanelOnLaunch ?? DEFAULT_OPEN_PANEL_ON_LAUNCH,
    enableLiveSessions: config.enableLiveSessions ?? DEFAULT_ENABLE_LIVE_SESSIONS,
    peerjsHost: config.peerjsHost || DEFAULT_PEERJS_HOST,
    peerjsPort: config.peerjsPort ?? DEFAULT_PEERJS_PORT,
    peerjsKey: config.peerjsKey || DEFAULT_PEERJS_KEY,
    peerjsSecure: config.peerjsSecure ?? DEFAULT_PEERJS_SECURE,
    enableCodaTerminal: config.enableCodaTerminal ?? DEFAULT_ENABLE_CODA_TERMINAL,
  };
}

export interface ConfigurationFormProps extends PluginConfigPageProps<AppPluginMeta<JsonData>> {}

const ConfigurationForm = ({ plugin }: ConfigurationFormProps) => {
  const urlParams = new URLSearchParams(window.location.search);
  const hasDevParam = urlParams.get('dev') === 'true';
  const s = useStyles2(getStyles);
  // Seeded through `useSeededDraft`, which reads the store this tab writes to.
  // `enabled`/`pinned` stay unread here: echoing a stale snapshot of them is what
  // unpinned the plugin (`aa1c2efd`). saveTenantSettings reads them at write time.
  const { draft: state, edit: editDraft, config: resolvedConfig } = useSeededDraft(buildStateFromConfig);
  const [isSaving, setIsSaving] = useState(false);
  const [portError, setPortError] = useState<string | undefined>(undefined);

  // Both gates: the tenant flag, and this browser's own opt-in.
  const devModeEnabledForUser = isDevModeEnabled(resolvedConfig);
  const tenantDevModeEnabled = resolvedConfig.devMode;
  const [devModeToggling, setDevModeToggling] = useState<boolean>(false);
  const [tenantDevModeToggling, setTenantDevModeToggling] = useState<boolean>(false);

  const assistantDevModeEnabled = resolvedConfig.enableAssistantDevMode;
  const [assistantDevModeToggling, setAssistantDevModeToggling] = useState<boolean>(false);

  // Show dev mode input if URL param is set OR if dev mode is already enabled for this user
  const showDevModeInput = hasDevParam || devModeEnabledForUser;

  // Show advanced config fields only in dev mode (for Grafana team development)
  const showAdvancedConfig = devModeEnabledForUser || showDevModeInput;

  const isRecommenderUrlMissing = showAdvancedConfig && !state.recommenderServiceUrl;
  const isSubmitDisabled = isRecommenderUrlMissing || portError !== undefined;

  const onChangeRecommenderServiceUrl = (event: ChangeEvent<HTMLInputElement>) => {
    editDraft({ recommenderServiceUrl: event.target.value.trim() });
  };

  const onChangeTutorialUrl = (event: ChangeEvent<HTMLInputElement>) => {
    editDraft({ tutorialUrl: event.target.value.trim() });
  };

  const onChangeDevMode = async (event: ChangeEvent<HTMLInputElement>) => {
    setDevModeToggling(true);
    try {
      // Both gates must be true for anything to appear, so turning on lifts the
      // tenant gate too. Turning off touches only this browser — revoking the
      // stack-wide gate is the separate admin switch below.
      if (!devModeEnabledForUser && !tenantDevModeEnabled) {
        await saveTenantSettings({ pluginId: plugin.meta.id, changes: { devMode: true } });
      }

      await toggleDevMode(devModeEnabledForUser);

      // Reload page to refresh plugin config and apply changes globally
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (error) {
      logger.error('Failed to toggle dev mode', { error });

      // Show user-friendly error message
      const errorMessage = error instanceof Error ? error.message : 'Failed to toggle dev mode. Please try again.';
      alert(errorMessage);

      setDevModeToggling(false);
    }
  };

  // The instance-level veto: the switch above can only ever lift the gate.
  const onChangeTenantDevMode = async (event: ChangeEvent<HTMLInputElement>) => {
    const enabled = event.target.checked;
    setTenantDevModeToggling(true);
    try {
      await saveTenantSettings({ pluginId: plugin.meta.id, changes: { devMode: enabled } });

      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (error) {
      logger.error('Failed to toggle stack-wide dev mode', { error });

      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to change dev mode for this stack. You may need admin permissions.';
      alert(errorMessage);

      setTenantDevModeToggling(false);
    }
  };

  const onChangeAssistantDevMode = async (event: ChangeEvent<HTMLInputElement>) => {
    setAssistantDevModeToggling(true);
    try {
      const newValue = event.target.checked;

      await saveTenantSettings({
        pluginId: plugin.meta.id,
        changes: { enableAssistantDevMode: newValue },
      });

      // Reload page to refresh plugin config and apply changes globally
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (error) {
      logger.error('Failed to toggle assistant dev mode', { error });

      const errorMessage =
        error instanceof Error ? error.message : 'Failed to toggle assistant dev mode. You may need admin permissions.';
      alert(errorMessage);

      setAssistantDevModeToggling(false);
    }
  };

  const onToggleGlobalLinkInterception = (event: ChangeEvent<HTMLInputElement>) => {
    editDraft({ interceptGlobalDocsLinks: event.target.checked });
  };

  const onToggleOpenPanelOnLaunch = (event: ChangeEvent<HTMLInputElement>) => {
    editDraft({ openPanelOnLaunch: event.target.checked });
  };

  const onToggleLiveSessions = (event: ChangeEvent<HTMLInputElement>) => {
    editDraft({ enableLiveSessions: event.target.checked });
  };

  const onToggleCodaTerminal = (event: ChangeEvent<HTMLInputElement>) => {
    editDraft({ enableCodaTerminal: event.target.checked });
  };

  const onChangePeerjsHost = (event: ChangeEvent<HTMLInputElement>) => {
    editDraft({ peerjsHost: event.target.value.trim() });
  };

  const onChangePeerjsPort = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value.trim();
    const port = value === '' ? DEFAULT_PEERJS_PORT : parseInt(value, 10);
    const resolved = isNaN(port) ? DEFAULT_PEERJS_PORT : port;
    const { min, max } = TENANT_SETTING_BOUNDS.peerjsPort;

    // The kind 422s an out-of-range port, and a save carries the whole config —
    // so an unvalidated port here fails every tab's save, not just this one's.
    setPortError(resolved < min || resolved > max ? `Must be between ${min} and ${max}` : undefined);
    editDraft({ peerjsPort: resolved });
  };

  const onChangePeerjsKey = (event: ChangeEvent<HTMLInputElement>) => {
    editDraft({ peerjsKey: event.target.value.trim() });
  };

  const onTogglePeerjsSecure = (event: ChangeEvent<HTMLInputElement>) => {
    editDraft({ peerjsSecure: event.target.checked });
  };

  const onSubmit = async (event: React.SubmitEvent) => {
    event.preventDefault();
    setIsSaving(true);

    try {
      // Only the fields this tab owns. saveTenantSettings reads the current
      // settings authoritatively and preserves everything else, so this form
      // cannot clobber another tab's values or the provisioned ones.
      await saveTenantSettings({
        pluginId: plugin.meta.id,
        changes: {
          recommenderServiceUrl: state.recommenderServiceUrl,
          tutorialUrl: state.tutorialUrl,
          interceptGlobalDocsLinks: state.interceptGlobalDocsLinks,
          openPanelOnLaunch: state.openPanelOnLaunch,
          enableLiveSessions: state.enableLiveSessions,
          peerjsHost: state.peerjsHost,
          peerjsPort: state.peerjsPort,
          peerjsKey: state.peerjsKey,
          peerjsSecure: state.peerjsSecure,
          enableCodaTerminal: state.enableCodaTerminal,
        },
      });

      setTimeout(() => {
        try {
          window.location.reload();
        } catch (e) {
          logger.error('Failed to reload page after saving configuration', { error: e });
        }
      }, 100);
    } catch (error) {
      logger.error('Error saving configuration', { error });
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={onSubmit} data-testid={testIds.appConfig.form}>
      <FieldSet label="Plugin configuration" className={s.marginTopXl}>
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
                placeholder={getDefaultRecommenderUrl()}
                onChange={onChangeRecommenderServiceUrl}
              />
            </Field>
          </>
        )}

        {/* Tutorial URL - available to all users */}
        <Field
          label="Auto-launch tutorial URL"
          description="Optional: URL of a learning path or documentation page to automatically open when the Interactive learning panel opens. Useful for demo scenarios. Can be set via environment variable GRAFANA_INTERACTIVE_LEARNING_TUTORIAL_URL"
          className={s.marginTop}
        >
          <Input
            width={60}
            id="tutorial-url"
            data-testid={testIds.appConfig.tutorialUrl}
            value={state.tutorialUrl}
            placeholder="https://grafana.com/docs/learning-paths/..."
            onChange={onChangeTutorialUrl}
          />
        </Field>

        {/* Dev Mode - Per-User Setting (stored server-side in Grafana user preferences) */}
        {showDevModeInput && (
          <>
            <Field
              label="Dev mode"
              description="⚠️ WARNING: Disables security protections. Only enable in isolated development environments. Turning this on also enables dev mode for the stack; turning it off affects only this browser."
              className={s.marginTop}
            >
              <div className={s.devModeField} data-testid={testIds.appConfig.pathfinderDevMode}>
                <Input
                  type="checkbox"
                  id="dev-mode"
                  data-testid={testIds.appConfig.devModeToggle}
                  checked={devModeEnabledForUser}
                  onChange={onChangeDevMode}
                  disabled={devModeToggling}
                />
                {devModeToggling && <span className={s.updateText}>Saving to server and reloading...</span>}
              </div>
            </Field>

            <Field
              label="Dev mode for this stack"
              description="The instance-level gate. When off, developer surfaces are hidden for every user regardless of their own opt-in. Requires admin permissions to change."
              className={s.marginTop}
            >
              <div className={s.devModeField} data-testid={testIds.appConfig.tenantDevMode}>
                <Input
                  type="checkbox"
                  id="tenant-dev-mode"
                  data-testid={testIds.appConfig.tenantDevModeToggle}
                  checked={tenantDevModeEnabled}
                  onChange={onChangeTenantDevMode}
                  disabled={tenantDevModeToggling}
                />
                {tenantDevModeToggling && <span className={s.updateText}>Saving to server and reloading...</span>}
              </div>
            </Field>

            {/* Assistant Dev Mode - Only show when main dev mode is enabled */}
            {devModeEnabledForUser && (
              <Field
                label="Enable Assistant (Dev Mode)"
                description="Mock the Grafana Assistant in OSS environments for testing. When enabled, the assistant popover will appear on text selection and log prompts to console instead of opening the real assistant."
                className={s.marginTop}
              >
                <div className={s.devModeField}>
                  <Input
                    type="checkbox"
                    id="assistant-dev-mode"
                    data-testid={testIds.appConfig.assistantDevModeToggle}
                    checked={assistantDevModeEnabled}
                    onChange={onChangeAssistantDevMode}
                    disabled={assistantDevModeToggling}
                  />
                  {assistantDevModeToggling && <span className={s.updateText}>Saving to server and reloading...</span>}
                </div>
              </Field>
            )}

            {devModeEnabledForUser && (
              <Alert severity="warning" title="⚠️ Dev mode security warning" className={s.marginTop}>
                <Text variant="body" weight="bold">
                  Dev mode disables critical security protections:
                </Text>
                <ul style={{ marginTop: '8px', marginBottom: '8px' }}>
                  <li>Allows loading content from ANY localhost URL (bypasses domain validation)</li>
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
              data-testid={testIds.appConfig.globalLinkInterception}
              value={state.interceptGlobalDocsLinks}
              onChange={onToggleGlobalLinkInterception}
            />
            <div className={s.toggleLabels}>
              <Text variant="body" weight="medium">
                Intercept documentation links globally
              </Text>
              <Text variant="body" color="secondary">
                When enabled, clicking Grafana docs links anywhere will open them in Interactive learning instead of a
                new tab
              </Text>
            </div>
          </div>

          {state.interceptGlobalDocsLinks && (
            <Alert severity="info" title="How it works" className={s.marginTop}>
              <Text variant="body">
                When you click a documentation link anywhere in Grafana, Interactive learning will automatically open
                the sidebar (if closed) and display the documentation inside. Links are queued if the sidebar
                hasn&apos;t fully loaded yet.
                <br />
                <br />
                Hold <strong>Ctrl</strong> (Windows/Linux) or <strong>Cmd</strong> (Mac) while clicking any link to open
                it in a new tab instead of Interactive learning. Middle-click also opens in a new tab.
              </Text>
            </Alert>
          )}
        </FieldSet>

        {/* Open Panel on Launch */}
        <FieldSet
          label={
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              Open Panel on Launch
              <Badge text="Experimental" color="orange" />
            </div>
          }
          className={s.marginTopXl}
        >
          <div className={s.toggleSection}>
            <Switch
              id="enable-open-panel-on-launch"
              data-testid={testIds.appConfig.openPanelOnLaunch}
              value={state.openPanelOnLaunch}
              onChange={onToggleOpenPanelOnLaunch}
            />
            <div className={s.toggleLabels}>
              <Text variant="body" weight="medium">
                Automatically open Interactive learning panel when Grafana loads
              </Text>
              <Text variant="body" color="secondary">
                When enabled, the Interactive learning sidebar will automatically open when you first load Grafana (only
                on initial load, not on every page navigation)
              </Text>
            </div>
          </div>

          {state.openPanelOnLaunch && (
            <Alert severity="info" title="How it works" className={s.marginTop}>
              <Text variant="body">
                The Interactive learning sidebar will automatically open when Grafana loads for the first time in your
                browser session. It will not reopen on subsequent page navigations within Grafana. The panel will reset
                to auto-open behavior when you refresh the entire page or start a new browser session.
              </Text>
            </Alert>
          )}
        </FieldSet>

        {/* Live sessions (collaborative learning) - Dev Mode Only */}
        {devModeEnabledForUser && (
          <FieldSet
            label={
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                Live sessions (collaborative learning)
                <Badge text="Experimental - Dev Mode Only" color="orange" />
              </div>
            }
            className={s.marginTopXl}
          >
            <div className={s.toggleSection}>
              <Switch
                id="enable-live-sessions"
                data-testid={testIds.appConfig.liveSessionsToggle}
                value={state.enableLiveSessions}
                onChange={onToggleLiveSessions}
              />
              <div className={s.toggleLabels}>
                <Text variant="body" weight="medium">
                  Enable live collaborative learning sessions (Experimental)
                </Text>
                <Text variant="body" color="secondary">
                  Allow presenters to create live sessions where attendees can follow along with interactive guides in
                  real-time
                </Text>
              </div>
            </div>

            {state.enableLiveSessions && (
              <>
                <Alert severity="warning" title="⚠️ Experimental Feature" className={s.marginTop}>
                  <Text variant="body">
                    <strong>This feature is experimental and may have stability issues.</strong> Connection reliability
                    depends on network configuration and the availability of the PeerJS signaling server. Not
                    recommended for production-critical workflows.
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

                  <Field label="Server host" description="Hostname or IP address">
                    <Input
                      data-testid={testIds.appConfig.peerjsHost}
                      value={state.peerjsHost}
                      onChange={onChangePeerjsHost}
                      placeholder={DEFAULT_PEERJS_HOST}
                    />
                  </Field>

                  <Field
                    label="Server port"
                    description={`Port number (${TENANT_SETTING_BOUNDS.peerjsPort.min}-${TENANT_SETTING_BOUNDS.peerjsPort.max})`}
                    invalid={portError !== undefined}
                    error={portError}
                  >
                    <Input
                      type="number"
                      min={TENANT_SETTING_BOUNDS.peerjsPort.min}
                      max={TENANT_SETTING_BOUNDS.peerjsPort.max}
                      data-testid={testIds.appConfig.peerjsPort}
                      value={state.peerjsPort}
                      onChange={onChangePeerjsPort}
                      placeholder={String(DEFAULT_PEERJS_PORT)}
                    />
                  </Field>

                  <Field label="API Key" description="Authentication key">
                    <Input
                      data-testid={testIds.appConfig.peerjsKey}
                      value={state.peerjsKey}
                      onChange={onChangePeerjsKey}
                      placeholder={DEFAULT_PEERJS_KEY}
                    />
                  </Field>

                  <Field label="Use TLS (wss://)" description="Enable for servers using HTTPS/WSS">
                    <Switch id="peerjs-secure" value={state.peerjsSecure} onChange={onTogglePeerjsSecure} />
                  </Field>
                </div>
              </>
            )}

            {!state.enableLiveSessions && (
              <Alert severity="warning" title="Experimental feature disabled" className={s.marginTop}>
                <Text variant="body">
                  Live sessions are currently disabled. This is an <strong>experimental feature</strong> that enables
                  collaborative learning experiences where presenters can guide attendees through interactive guides in
                  real-time.
                  <br />
                  <br />
                  <strong>Note:</strong> This feature uses peer-to-peer connections and may have stability issues
                  depending on network configuration. Enable only if you understand the limitations and have tested it
                  in your environment.
                </Text>
              </Alert>
            )}
          </FieldSet>
        )}

        {/* Coda Terminal (interactive sandbox) - Dev Mode Only */}
        {devModeEnabledForUser && (
          <FieldSet
            label={
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                Coda terminal (interactive sandbox)
                <Badge text="Experimental - Dev Mode Only" color="orange" />
              </div>
            }
            className={s.marginTopXl}
          >
            <div className={s.toggleSection}>
              <Switch
                id="enable-coda-terminal"
                data-testid={testIds.appConfig.codaTerminalToggle}
                value={state.enableCodaTerminal}
                onChange={onToggleCodaTerminal}
              />
              <div className={s.toggleLabels}>
                <Text variant="body" weight="medium">
                  Enable Coda terminal in sidebar (Experimental)
                </Text>
                <Text variant="body" color="secondary">
                  Show a collapsible terminal panel at the bottom of the Interactive learning sidebar for running
                  commands in a sandbox environment
                </Text>
              </div>
            </div>

            <CodaBackendStatus enabled={state.enableCodaTerminal} className={s.marginTop} />
          </FieldSet>
        )}

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
