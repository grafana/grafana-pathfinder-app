import React, { useState, ChangeEvent, useEffect } from 'react';
import { Button, Field, Input, useStyles2, FieldSet, SecretInput } from '@grafana/ui';
import { PluginConfigPageProps, AppPluginMeta, GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { testIds } from '../testIds';
import {
  DocsPluginConfig,
  DEFAULT_RECOMMENDER_SERVICE_URL,
  DEFAULT_DOCS_BASE_URL,
  DEFAULT_DOCS_USERNAME,
  DEFAULT_TUTORIAL_URL,
  ConfigService,
} from '../../constants';

type JsonData = DocsPluginConfig & {
  isDocsPasswordSet?: boolean;
};

type State = {
  // The URL to reach the recommender service
  recommenderServiceUrl: string;
  // The base URL for the docs service
  docsBaseUrl: string;
  // Username for docs authentication
  docsUsername: string;
  // Password for docs authentication
  docsPassword: string;
  // Tells us if the docs password secret is set
  isDocsPasswordSet: boolean;
  // Auto-launch tutorial URL (for demo scenarios)
  tutorialUrl: string;
};

export interface ConfigurationFormProps extends PluginConfigPageProps<AppPluginMeta<JsonData>> {}

const ConfigurationForm = ({ plugin }: ConfigurationFormProps) => {
  const s = useStyles2(getStyles);
  const { enabled, pinned, jsonData } = plugin.meta;
  const [state, setState] = useState<State>({
    recommenderServiceUrl: jsonData?.recommenderServiceUrl || DEFAULT_RECOMMENDER_SERVICE_URL,
    docsBaseUrl: jsonData?.docsBaseUrl || DEFAULT_DOCS_BASE_URL,
    docsUsername: jsonData?.docsUsername || DEFAULT_DOCS_USERNAME,
    docsPassword: '',
    isDocsPasswordSet: Boolean(jsonData?.isDocsPasswordSet),
    tutorialUrl: jsonData?.tutorialUrl || DEFAULT_TUTORIAL_URL,
  });

  // Update the configuration service when the config changes
  useEffect(() => {
    if (jsonData) {
      ConfigService.setConfig({
        recommenderServiceUrl: jsonData.recommenderServiceUrl,
        docsBaseUrl: jsonData.docsBaseUrl,
        docsUsername: jsonData.docsUsername,
        docsPassword: jsonData.docsPassword,
        tutorialUrl: jsonData.tutorialUrl,
        acceptedTermsAndConditions: jsonData.acceptedTermsAndConditions,
        termsVersion: jsonData.termsVersion,
      });
    }
  }, [jsonData]);

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

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const newConfig: DocsPluginConfig = {
      ...jsonData,
      recommenderServiceUrl: state.recommenderServiceUrl,
      docsBaseUrl: state.docsBaseUrl,
      docsUsername: state.docsUsername,
      docsPassword: state.docsPassword,
      tutorialUrl: state.tutorialUrl,
    };

    // Update the configuration service
    ConfigService.setConfig(newConfig);

    await updatePluginAndReload(plugin.meta.id, {
      enabled,
      pinned,
      jsonData: {
        ...newConfig,
        isDocsPasswordSet: state.isDocsPasswordSet || Boolean(state.docsPassword),
      },
      // This cannot be queried later by the frontend.
      // We don't want to override it in case it was set previously and left untouched now.
      secureJsonData: state.isDocsPasswordSet
        ? undefined
        : {
            docsPassword: state.docsPassword,
          },
    });
  };

  return (
    <form onSubmit={onSubmit}>
      <FieldSet label="Plugin Configuration" className={s.marginTopXl}>
        {/* Recommender Service URL */}
        <Field
          label="Recommender Service URL"
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

        {/* Docs Base URL */}
        <Field label="Docs Base URL" description="The base URL for the documentation service" className={s.marginTop}>
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
          label="Docs Username"
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
          label="Docs Password"
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
          label="Auto-Launch Tutorial URL"
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

        <div className={s.marginTop}>
          <Button type="submit" data-testid={testIds.appConfig.submit} disabled={isSubmitDisabled}>
            Save Configuration
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
});

// Helper function to update plugin (reused from AppConfig.tsx)
const updatePluginAndReload = async (pluginId: string, data: any) => {
  const { getBackendSrv, locationService } = await import('@grafana/runtime');
  const { lastValueFrom } = await import('rxjs');

  try {
    const response = getBackendSrv().fetch({
      url: `/api/plugins/${pluginId}/settings`,
      method: 'POST',
      data,
    });

    await lastValueFrom(response as any);

    // Reloading the page as the changes made here wouldn't be propagated to the actual plugin otherwise.
    // This is not ideal, however unfortunately currently there is no supported way for updating the plugin state.
    locationService.reload();
  } catch (e) {
    console.error('Error while updating the plugin', e);
  }
};
