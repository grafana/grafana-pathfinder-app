import React, { useState, ChangeEvent, useEffect } from 'react';
import { Button, useStyles2, FieldSet, Switch, Text, Alert } from '@grafana/ui';
import { AppPluginMeta, GrafanaTheme2, PluginMeta, PluginConfigPageProps } from '@grafana/data';
import { css } from '@emotion/css';
import { testIds } from '../testIds';
import { DocsPluginConfig, ConfigService, TERMS_VERSION } from '../../constants';
import { TERMS_AND_CONDITIONS_CONTENT } from './terms-content';

type JsonData = DocsPluginConfig & {
  isDocsPasswordSet?: boolean;
};

export interface TermsAndConditionsProps extends PluginConfigPageProps<AppPluginMeta<JsonData>> {}

const TermsAndConditions = ({ plugin }: TermsAndConditionsProps) => {
  const styles = useStyles2(getStyles);
  const { enabled, pinned, jsonData } = plugin.meta;

  const [isRecommenderEnabled, setIsRecommenderEnabled] = useState<boolean>(
    Boolean(jsonData?.acceptedTermsAndConditions)
  );
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Update the configuration service when the config changes (similar to ConfigurationForm)
  useEffect(() => {
    if (jsonData) {
      ConfigService.setConfig(jsonData);
    }
  }, [jsonData]);

  // Sync local state with jsonData when it changes (after reload)
  useEffect(() => {
    const newToggleState = Boolean(jsonData?.acceptedTermsAndConditions);
    setIsRecommenderEnabled(newToggleState);
  }, [jsonData?.acceptedTermsAndConditions]);

  const onToggleRecommender = (event: ChangeEvent<HTMLInputElement>) => {
    setIsRecommenderEnabled(event.target.checked);
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);

    try {
      const newConfig: DocsPluginConfig = {
        ...jsonData,
        acceptedTermsAndConditions: isRecommenderEnabled,
        termsVersion: TERMS_VERSION,
      };

      // Update the configuration service
      ConfigService.setConfig(newConfig);

      await updatePluginAndReload(plugin.meta.id, {
        enabled,
        pinned,
        jsonData: {
          ...jsonData, // Preserve all existing jsonData fields
          ...newConfig, // Apply the new config
        },
      });
    } catch (error) {
      console.error('Error saving Terms and Conditions:', error);
    } finally {
      setIsSaving(false);
    }
  };

  // Convert markdown-like content to JSX for basic rendering
  const renderTermsContent = (content: string) => {
    const lines = content.split('\n');
    return lines.map((line, index) => {
      if (line.startsWith('# ')) {
        return (
          <h2 key={index} className={styles.heading}>
            {line.substring(2)}
          </h2>
        );
      } else if (line.startsWith('## ')) {
        return (
          <h3 key={index} className={styles.subheading}>
            {line.substring(3)}
          </h3>
        );
      } else if (line.startsWith('### ')) {
        return (
          <h4 key={index} className={styles.subsubheading}>
            {line.substring(4)}
          </h4>
        );
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        return (
          <li key={index} className={styles.listItem}>
            {line.substring(2)}
          </li>
        );
      } else if (line.startsWith('**') && line.endsWith('**')) {
        return (
          <p key={index} className={styles.bold}>
            {line.substring(2, line.length - 2)}
          </p>
        );
      } else if (line.trim() === '') {
        return <br key={index} />;
      } else if (line.trim() === '---') {
        return <hr key={index} className={styles.divider} />;
      } else {
        return (
          <p key={index} className={styles.paragraph}>
            {line}
          </p>
        );
      }
    });
  };

  return (
    <form onSubmit={onSubmit}>
      <FieldSet label="Recommender Service" className={styles.termsFieldSet}>
        <div className={styles.toggleSection}>
          <div className={styles.toggleHeader}>
            <Switch
              data-testid={testIds.termsAndConditions.toggle}
              id="recommender-enabled"
              value={isRecommenderEnabled}
              onChange={onToggleRecommender}
            />
            <div className={styles.toggleLabels}>
              <Text variant="body" weight="medium">
                Enable Context-Aware Recommendations
              </Text>
              <Text variant="body" color="secondary">
                {isRecommenderEnabled
                  ? 'Personalized documentation recommendations based on your current context'
                  : 'Only bundled examples will be shown'}
              </Text>
            </div>
          </div>
        </div>

        <Alert title="Data Usage Information" severity={isRecommenderEnabled ? 'info' : 'warning'}>
          {isRecommenderEnabled
            ? "When enabled, contextual data from your Grafana instance will be sent to Grafana's hosted recommendation service to provide personalized recommendations. Review the details below."
            : "If you enable this feature, contextual data from your Grafana instance will be sent to Grafana's hosted recommendation service. Please review the data usage details below before enabling."}
        </Alert>

        <div className={styles.termsContainer} data-testid={testIds.termsAndConditions.termsContent}>
          {renderTermsContent(TERMS_AND_CONDITIONS_CONTENT)}
        </div>

        <div className={styles.button}>
          <Button type="submit" data-testid={testIds.termsAndConditions.submit} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </FieldSet>
    </form>
  );
};

export default TermsAndConditions;

const getStyles = (theme: GrafanaTheme2) => ({
  termsFieldSet: css({
    label: 'terms-field-set',
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
  }),
  toggleSection: css({
    marginBottom: theme.spacing(2),
  }),
  toggleHeader: css({
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(2),
  }),
  toggleLabels: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    flex: 1,
  }),
  termsContainer: css({
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    padding: theme.spacing(2),
    marginTop: theme.spacing(2),
    marginBottom: theme.spacing(2),
    maxHeight: '400px',
    overflowY: 'auto',
  }),
  button: css({
    marginTop: theme.spacing(2),
  }),
  heading: css({
    fontSize: theme.typography.h2.fontSize,
    fontWeight: theme.typography.h2.fontWeight,
    marginTop: theme.spacing(2),
    marginBottom: theme.spacing(1),
    color: theme.colors.text.primary,
  }),
  subheading: css({
    fontSize: theme.typography.h3.fontSize,
    fontWeight: theme.typography.h3.fontWeight,
    marginTop: theme.spacing(2),
    marginBottom: theme.spacing(1),
    color: theme.colors.text.primary,
  }),
  subsubheading: css({
    fontSize: theme.typography.h4.fontSize,
    fontWeight: theme.typography.h4.fontWeight,
    marginTop: theme.spacing(1.5),
    marginBottom: theme.spacing(0.5),
    color: theme.colors.text.primary,
  }),
  paragraph: css({
    margin: `${theme.spacing(0.5)} 0`,
    color: theme.colors.text.secondary,
    lineHeight: 1.4,
  }),
  bold: css({
    margin: `${theme.spacing(0.5)} 0`,
    fontWeight: theme.typography.fontWeightBold,
    color: theme.colors.text.primary,
  }),
  listItem: css({
    marginLeft: theme.spacing(2),
    marginBottom: theme.spacing(0.5),
    color: theme.colors.text.secondary,
  }),
  divider: css({
    border: 'none',
    borderTop: `1px solid ${theme.colors.border.weak}`,
    margin: `${theme.spacing(2)} 0`,
  }),
});

// Helper function to update plugin (reused from AppConfig.tsx)
const updatePluginAndReload = async (pluginId: string, data: Partial<PluginMeta<JsonData>>) => {
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
