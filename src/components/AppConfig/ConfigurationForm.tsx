import React, { useState, useEffect, useCallback, useRef, ChangeEvent } from 'react';
import { Button, Field, Input, useStyles2, FieldSet, Switch, Alert, Text, Badge, Spinner } from '@grafana/ui';
import { PluginConfigPageProps, AppPluginMeta, GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { testIds } from '../../constants/testIds';
import {
  DocsPluginConfig,
  DEFAULT_RECOMMENDER_SERVICE_URL,
  DEFAULT_TUTORIAL_URL,
  DEFAULT_INTERCEPT_GLOBAL_DOCS_LINKS,
  DEFAULT_OPEN_PANEL_ON_LAUNCH,
  DEFAULT_ENABLE_LIVE_SESSIONS,
  DEFAULT_PEERJS_HOST,
  DEFAULT_PEERJS_PORT,
  DEFAULT_PEERJS_KEY,
  DEFAULT_ENABLE_CODA_TERMINAL,
  DEFAULT_CODA_RELAY_URL,
  CODA_API_URL,
  PLUGIN_BACKEND_URL,
} from '../../constants';
import { updatePluginSettings } from '../../utils/utils.plugin';
import { isDevModeEnabled, toggleDevMode } from '../../utils/dev-mode';
import { config, getBackendSrv } from '@grafana/runtime';

type JsonData = DocsPluginConfig;

type State = {
  // The URL to reach the recommender service
  recommenderServiceUrl: string;
  // Auto-launch tutorial URL (for demo scenarios)
  tutorialUrl: string;
  // Global link interception
  interceptGlobalDocsLinks: boolean;
  // Open panel on launch
  openPanelOnLaunch: boolean;
  // Live sessions (collaborative learning)
  enableLiveSessions: boolean;
  peerjsHost: string;
  peerjsPort: number;
  peerjsKey: string;
  // Coda terminal (experimental)
  enableCodaTerminal: boolean;
  // Coda enrollment key (for JWT registration)
  codaEnrollmentKey: string;
  // Coda relay URL (for Grafana Cloud deployments)
  codaRelayUrl: string;
};

export interface ConfigurationFormProps extends PluginConfigPageProps<AppPluginMeta<JsonData>> {}

const ConfigurationForm = ({ plugin }: ConfigurationFormProps) => {
  const urlParams = new URLSearchParams(window.location.search);
  const hasDevParam = urlParams.get('dev') === 'true';
  const s = useStyles2(getStyles);
  const { enabled, pinned, jsonData } = plugin.meta;

  // SINGLE SOURCE OF TRUTH: Initialize draft state ONCE from jsonData
  // After save, page reload brings fresh jsonData - no sync needed
  const [state, setState] = useState<State>(() => ({
    recommenderServiceUrl: jsonData?.recommenderServiceUrl || DEFAULT_RECOMMENDER_SERVICE_URL,
    tutorialUrl: jsonData?.tutorialUrl || DEFAULT_TUTORIAL_URL,
    interceptGlobalDocsLinks: jsonData?.interceptGlobalDocsLinks ?? DEFAULT_INTERCEPT_GLOBAL_DOCS_LINKS,
    openPanelOnLaunch: jsonData?.openPanelOnLaunch ?? DEFAULT_OPEN_PANEL_ON_LAUNCH,
    enableLiveSessions: jsonData?.enableLiveSessions ?? DEFAULT_ENABLE_LIVE_SESSIONS,
    peerjsHost: jsonData?.peerjsHost || DEFAULT_PEERJS_HOST,
    peerjsPort: jsonData?.peerjsPort ?? DEFAULT_PEERJS_PORT,
    peerjsKey: jsonData?.peerjsKey || DEFAULT_PEERJS_KEY,
    enableCodaTerminal: jsonData?.enableCodaTerminal ?? DEFAULT_ENABLE_CODA_TERMINAL,
    codaEnrollmentKey: '', // Enrollment key is stored in secureJsonData, never loaded into state
    codaRelayUrl: jsonData?.codaRelayUrl || DEFAULT_CODA_RELAY_URL,
  }));
  const [isSaving, setIsSaving] = useState(false);

  // Coda registration state
  const codaRegistered = jsonData?.codaRegistered ?? false;
  const hasProvisionedKey = plugin.meta.secureJsonFields?.codaEnrollmentKey ?? false;
  const [isRegistering, setIsRegistering] = useState(false);
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const autoRegisterAttempted = useRef(false);

  // SECURITY: Dev mode - hybrid approach (jsonData storage, multi-user ID scoping)
  // Get current user ID for scoping
  const currentUserId = config.bootData.user?.id;
  const devModeUserIds = jsonData?.devModeUserIds ?? [];

  // Check if dev mode is enabled for THIS user (synchronous)
  const devModeEnabledForUser = isDevModeEnabled(jsonData || {}, currentUserId);
  const [devModeToggling, setDevModeToggling] = useState<boolean>(false);

  // Assistant dev mode state
  const assistantDevModeEnabled = jsonData?.enableAssistantDevMode ?? false;
  const [assistantDevModeToggling, setAssistantDevModeToggling] = useState<boolean>(false);

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

  const onChangeAssistantDevMode = async (event: ChangeEvent<HTMLInputElement>) => {
    setAssistantDevModeToggling(true);
    try {
      const newValue = event.target.checked;

      await updatePluginSettings(plugin.meta.id, {
        enabled,
        pinned,
        jsonData: {
          ...jsonData,
          enableAssistantDevMode: newValue,
        },
      });

      // Reload page to refresh plugin config and apply changes globally
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (error) {
      console.error('Failed to toggle assistant dev mode:', error);

      const errorMessage =
        error instanceof Error ? error.message : 'Failed to toggle assistant dev mode. You may need admin permissions.';
      alert(errorMessage);

      setAssistantDevModeToggling(false);
    }
  };

  const onToggleGlobalLinkInterception = (event: ChangeEvent<HTMLInputElement>) => {
    setState({
      ...state,
      interceptGlobalDocsLinks: event.target.checked,
    });
  };

  const onToggleOpenPanelOnLaunch = (event: ChangeEvent<HTMLInputElement>) => {
    setState({
      ...state,
      openPanelOnLaunch: event.target.checked,
    });
  };

  const onToggleLiveSessions = (event: ChangeEvent<HTMLInputElement>) => {
    setState({
      ...state,
      enableLiveSessions: event.target.checked,
    });
  };

  const onToggleCodaTerminal = (event: ChangeEvent<HTMLInputElement>) => {
    setState({
      ...state,
      enableCodaTerminal: event.target.checked,
    });
  };

  const onChangeCodaEnrollmentKey = (event: ChangeEvent<HTMLInputElement>) => {
    setState({
      ...state,
      codaEnrollmentKey: event.target.value,
    });
    // Clear any previous registration error when user types
    setRegistrationError(null);
  };

  const onChangeCodaRelayUrl = (event: ChangeEvent<HTMLInputElement>) => {
    setState({
      ...state,
      codaRelayUrl: event.target.value.trim(),
    });
  };

  // Handle Coda registration - extracted as callback for reuse in auto-registration
  const performCodaRegistration = useCallback(
    async (enrollmentKeyOverride?: string) => {
      // Check if we have either a user-entered key or a provisioned key
      const keyToUse = enrollmentKeyOverride ?? '';
      if (!keyToUse && !hasProvisionedKey) {
        setRegistrationError('No enrollment key available');
        return;
      }

      setIsRegistering(true);
      setRegistrationError(null);

      try {
        // Generate a unique instance ID based on the Grafana instance
        const instanceId = `grafana-${config.bootData.settings.buildInfo.version}-${Date.now()}`;
        const instanceUrl = window.location.origin;

        // Call the plugin backend to register with Coda
        // Backend resources are accessed via /api/plugins/{pluginId}/resources/{path}
        // If enrollmentKey is empty, the backend will use the provisioned key from secureJsonData
        const response = await getBackendSrv().post(`${PLUGIN_BACKEND_URL}/coda/register`, {
          enrollmentKey: keyToUse, // Empty string if using provisioned key
          instanceId,
          instanceUrl,
        });

        // Save the refresh token to secureJsonData and update registration status
        // Only update enrollment key if user provided a new one (don't overwrite provisioned key with empty)
        const secureJsonDataUpdate: Record<string, string> = {
          codaRefreshToken: response.refreshToken,
        };
        if (keyToUse) {
          secureJsonDataUpdate.codaEnrollmentKey = keyToUse;
        }

        await updatePluginSettings(plugin.meta.id, {
          enabled,
          pinned,
          jsonData: {
            ...jsonData,
            codaRegistered: true,
          },
          secureJsonData: secureJsonDataUpdate,
        });

        // Reload page to apply changes
        setTimeout(() => {
          window.location.reload();
        }, 500);
      } catch (error) {
        console.error('Failed to register with Coda:', error);
        const errorMessage =
          error instanceof Error ? error.message : 'Failed to register with Coda. Please check your enrollment key.';
        setRegistrationError(errorMessage);
        setIsRegistering(false);
      }
    },
    [hasProvisionedKey, enabled, pinned, jsonData, plugin.meta.id]
  );

  // Auto-register with Coda when a provisioned enrollment key exists but not yet registered
  useEffect(() => {
    // Only auto-register once per mount, when:
    // - Coda terminal is enabled
    // - There's a provisioned key
    // - Not already registered
    // - Not currently registering
    if (
      state.enableCodaTerminal &&
      hasProvisionedKey &&
      !codaRegistered &&
      !isRegistering &&
      !autoRegisterAttempted.current
    ) {
      autoRegisterAttempted.current = true;
      console.log('Auto-registering with Coda using provisioned enrollment key...');
      queueMicrotask(() => performCodaRegistration());
    }
  }, [state.enableCodaTerminal, hasProvisionedKey, codaRegistered, isRegistering, performCodaRegistration]);

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
    setRegistrationError(null);

    try {
      let secureJsonDataUpdate: Record<string, string> = {};
      let shouldMarkRegistered = codaRegistered;

      // If Coda terminal is enabled, has enrollment key, and not yet registered - register now
      if (state.enableCodaTerminal && state.codaEnrollmentKey && !codaRegistered) {
        // Perform registration inline as part of the save
        const instanceId = `grafana-${config.bootData.settings.buildInfo.version}-${Date.now()}`;
        const instanceUrl = window.location.origin;

        const response = await getBackendSrv().post(`${PLUGIN_BACKEND_URL}/coda/register`, {
          enrollmentKey: state.codaEnrollmentKey,
          instanceId,
          instanceUrl,
        });

        secureJsonDataUpdate.codaRefreshToken = response.refreshToken;
        secureJsonDataUpdate.codaEnrollmentKey = state.codaEnrollmentKey;
        shouldMarkRegistered = true;
      }

      const newJsonData = {
        ...jsonData, // Preserve existing fields
        recommenderServiceUrl: state.recommenderServiceUrl,
        tutorialUrl: state.tutorialUrl,
        interceptGlobalDocsLinks: state.interceptGlobalDocsLinks,
        openPanelOnLaunch: state.openPanelOnLaunch,
        enableLiveSessions: state.enableLiveSessions,
        peerjsHost: state.peerjsHost,
        peerjsPort: state.peerjsPort,
        peerjsKey: state.peerjsKey,
        enableCodaTerminal: state.enableCodaTerminal,
        codaRelayUrl: state.codaRelayUrl,
        codaRegistered: shouldMarkRegistered,
      };

      await updatePluginSettings(plugin.meta.id, {
        enabled,
        pinned,
        jsonData: newJsonData,
        ...(Object.keys(secureJsonDataUpdate).length > 0 && { secureJsonData: secureJsonDataUpdate }),
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
      // Check if this was a registration error
      const errorMessage = error instanceof Error ? error.message : 'Failed to save configuration. Please try again.';
      if (state.enableCodaTerminal && state.codaEnrollmentKey && !codaRegistered) {
        setRegistrationError(errorMessage);
      }
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={onSubmit}>
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
                placeholder={DEFAULT_RECOMMENDER_SERVICE_URL}
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
              <Switch id="enable-live-sessions" value={state.enableLiveSessions} onChange={onToggleLiveSessions} />
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
                    <Input value={state.peerjsHost} onChange={onChangePeerjsHost} placeholder={DEFAULT_PEERJS_HOST} />
                  </Field>

                  <Field label="Server port" description="Port number">
                    <Input
                      type="number"
                      value={state.peerjsPort}
                      onChange={onChangePeerjsPort}
                      placeholder={String(DEFAULT_PEERJS_PORT)}
                    />
                  </Field>

                  <Field label="API Key" description="Authentication key">
                    <Input value={state.peerjsKey} onChange={onChangePeerjsKey} placeholder={DEFAULT_PEERJS_KEY} />
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
              <Switch id="enable-coda-terminal" value={state.enableCodaTerminal} onChange={onToggleCodaTerminal} />
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

            {state.enableCodaTerminal && (
              <>
                <Alert severity="warning" title="⚠️ Experimental Feature" className={s.marginTop}>
                  <Text variant="body">
                    <strong>This feature is experimental and requires backend infrastructure.</strong> The terminal
                    panel will be visible in the sidebar but connection functionality requires the Coda backend service.
                    This is intended for development and testing purposes only.
                  </Text>
                </Alert>

                {/* Coda registration configuration */}
                <div className={s.marginTop}>
                  <Text variant="h6">Coda Backend Registration</Text>
                  <div style={{ marginTop: '8px', marginBottom: '16px' }}>
                    <Text variant="body" color="secondary">
                      Register this Grafana instance with the Coda backend to enable VM provisioning. The API URL is
                      pre-configured: <code>{CODA_API_URL}</code>
                    </Text>
                  </div>

                  {/* Registration status */}
                  {codaRegistered && (
                    <Alert severity="success" title="Registered with Coda" className={s.marginTop}>
                      <Text variant="body">
                        This instance is registered with the Coda backend. VM provisioning is enabled.
                      </Text>
                    </Alert>
                  )}

                  {/* Relay URL configuration - shown when registered */}
                  {codaRegistered && (
                    <div className={s.marginTop}>
                      <Text variant="h6">SSH Relay Configuration (Grafana Cloud)</Text>
                      <div style={{ marginTop: '8px', marginBottom: '16px' }}>
                        <Text variant="body" color="secondary">
                          For Grafana Cloud deployments where direct SSH is blocked, configure the WebSocket relay URL.
                          Leave empty for self-hosted instances with direct network access to VMs.
                        </Text>
                      </div>

                      <Field
                        label="Relay URL"
                        description="WebSocket relay URL for SSH connections (e.g., wss://relay.lg.grafana-dev.com)"
                      >
                        <Input
                          width={60}
                          value={state.codaRelayUrl}
                          onChange={onChangeCodaRelayUrl}
                          placeholder="wss://relay.lg.grafana-dev.com"
                        />
                      </Field>

                      {state.codaRelayUrl && (
                        <Alert severity="info" title="Relay mode enabled" className={s.marginTop}>
                          <Text variant="body">
                            SSH connections will be tunneled through the WebSocket relay at{' '}
                            <code>{state.codaRelayUrl}</code>. This is required for Grafana Cloud where outbound TCP
                            port 22 is blocked.
                          </Text>
                        </Alert>
                      )}
                    </div>
                  )}

                  {/* Auto-registration with provisioned key */}
                  {!codaRegistered && hasProvisionedKey && isRegistering && (
                    <Alert severity="info" title="Auto-registering with Coda" className={s.marginTop}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Spinner inline={true} />
                        <Text variant="body">
                          Registering this instance with Coda using the provisioned enrollment key...
                        </Text>
                      </div>
                    </Alert>
                  )}

                  {/* Enrollment key input - shown when not registered */}
                  {!codaRegistered && (
                    <Field
                      label="Enrollment key"
                      description="Enter the enrollment key provided by your Coda administrator, then click Save configuration"
                      className={s.marginTop}
                    >
                      <Input
                        type="password"
                        width={60}
                        value={state.codaEnrollmentKey}
                        onChange={onChangeCodaEnrollmentKey}
                        placeholder="Enter enrollment key"
                        disabled={isSaving}
                      />
                    </Field>
                  )}

                  {/* Registration error display */}
                  {registrationError && (
                    <Alert severity="error" title="Registration failed" className={s.marginTop}>
                      <Text variant="body">{registrationError}</Text>
                    </Alert>
                  )}
                </div>
              </>
            )}

            {!state.enableCodaTerminal && (
              <Alert severity="info" title="Feature overview" className={s.marginTop}>
                <Text variant="body">
                  The Coda terminal provides an interactive sandbox environment directly within the Interactive learning
                  sidebar. When enabled, a collapsible terminal panel appears at the bottom of the sidebar, allowing you
                  to run commands while following along with tutorials.
                  <br />
                  <br />
                  <strong>Note:</strong> This feature requires backend infrastructure to function. Enable only if you
                  have the necessary backend services configured.
                </Text>
              </Alert>
            )}
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
