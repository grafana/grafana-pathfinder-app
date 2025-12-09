import React, { useState, ChangeEvent } from 'react';
import { Button, useStyles2, FieldSet, Switch, Text, Alert } from '@grafana/ui';
import { AppPluginMeta, GrafanaTheme2, PluginConfigPageProps } from '@grafana/data';
import { css } from '@emotion/css';
import { testIds } from '../testIds';
import { DocsPluginConfig, TERMS_VERSION, getConfigWithDefaults } from '../../constants';
import { TERMS_AND_CONDITIONS_CONTENT } from './terms-content';
import { updatePluginSettings } from '../../utils/utils.plugin';
import { sanitizeDocumentationHTML } from '../../security/html-sanitizer';
import { pauseFaroBeforeReload } from '../../lib/faro';

type JsonData = DocsPluginConfig & {
  isDocsPasswordSet?: boolean;
};

export interface TermsAndConditionsProps extends PluginConfigPageProps<AppPluginMeta<JsonData>> {}

const TermsAndConditions = ({ plugin }: TermsAndConditionsProps) => {
  const styles = useStyles2(getStyles);
  const { enabled, pinned, jsonData } = plugin.meta;

  // SINGLE SOURCE OF TRUTH: Initialize draft state ONCE from jsonData
  // After save, page reload brings fresh jsonData - no sync needed
  const [isRecommenderEnabled, setIsRecommenderEnabled] = useState<boolean>(() => {
    const configWithDefaults = getConfigWithDefaults(jsonData || {});
    return configWithDefaults.acceptedTermsAndConditions;
  });
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const onToggleRecommender = (event: ChangeEvent<HTMLInputElement>) => {
    setIsRecommenderEnabled(event.target.checked);
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);

    try {
      const newJsonData = {
        ...jsonData,
        acceptedTermsAndConditions: isRecommenderEnabled,
        // Persist the current terms version when enabling; leave unchanged when disabling
        termsVersion: isRecommenderEnabled ? TERMS_VERSION : jsonData?.termsVersion,
      };

      await updatePluginSettings(plugin.meta.id, {
        enabled,
        pinned,
        jsonData: newJsonData,
      });

      // Reload the page to ensure plugin context is refreshed with new settings
      // Use a small delay to ensure the save completes before reload
      setTimeout(() => {
        try {
          // Pause Faro before reload to prevent "Failed to fetch" errors
          pauseFaroBeforeReload();
          window.location.reload();
        } catch (e) {
          console.error('Failed to reload page after saving settings', e);
        }
      }, 100);

      // Reset saving state - let Grafana's plugin context system handle the refresh
      setIsSaving(false);
    } catch (error) {
      console.error('Error saving Terms and Conditions:', error);
      setIsSaving(false);
      // Re-throw to let user know something went wrong
      throw error;
    }
  };

  return (
    <form onSubmit={onSubmit}>
      <FieldSet label="Recommender service" className={styles.termsFieldSet}>
        <Alert title="Data usage information" severity={isRecommenderEnabled ? 'info' : 'warning'}>
          {isRecommenderEnabled
            ? "When enabled, contextual data from your Grafana instance will be sent to Grafana's hosted recommendation service to provide personalized recommendations. Review the details below."
            : "If you enable this feature, contextual data from your Grafana instance will be sent to Grafana's hosted recommendation service. Please review the data usage details below before enabling."}
        </Alert>

        {/* SECURITY: TERMS_AND_CONDITIONS_CONTENT is a static constant controlled by the dev team.
            Sanitized with DOMPurify as defense-in-depth against supply chain attacks. */}
        <div
          data-testid={testIds.termsAndConditions.termsContent}
          className={styles.termsContent}
          dangerouslySetInnerHTML={{ __html: sanitizeDocumentationHTML(TERMS_AND_CONDITIONS_CONTENT) }}
        />

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
                Enable context-aware recommendations
              </Text>
              <Text variant="body" color="secondary">
                {isRecommenderEnabled
                  ? 'Personalized documentation recommendations based on your current context'
                  : 'Only bundled examples will be shown'}
              </Text>
            </div>
          </div>
        </div>

        <div className={styles.button}>
          <Button type="submit" data-testid={testIds.termsAndConditions.submit} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save settings'}
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
    marginTop: theme.spacing(3),
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
  termsContent: css({
    marginTop: theme.spacing(2),
    marginBottom: theme.spacing(2),
    '& h2': {
      fontSize: theme.typography.h2.fontSize,
      fontWeight: theme.typography.h2.fontWeight,
      color: theme.colors.text.primary,
      marginTop: theme.spacing(2),
      marginBottom: theme.spacing(1),
    },
    '& h3': {
      fontSize: theme.typography.h3.fontSize,
      fontWeight: theme.typography.h3.fontWeight,
      color: theme.colors.text.primary,
      marginTop: theme.spacing(2),
      marginBottom: theme.spacing(1),
    },
    '& h4': {
      fontSize: theme.typography.h4.fontSize,
      fontWeight: theme.typography.h4.fontWeight,
      color: theme.colors.text.primary,
      marginTop: theme.spacing(1.5),
      marginBottom: theme.spacing(0.5),
    },
    '& p': {
      color: theme.colors.text.secondary,
      lineHeight: 1.4,
      marginBottom: theme.spacing(1),
    },
    '& ul': {
      paddingLeft: theme.spacing(2),
      marginBottom: theme.spacing(1),
    },
    '& li': {
      color: theme.colors.text.secondary,
      marginBottom: theme.spacing(0.5),
    },
    '& hr': {
      border: 'none',
      borderTop: `1px solid ${theme.colors.border.weak}`,
      margin: `${theme.spacing(2)} 0`,
    },
    '& strong': {
      fontWeight: theme.typography.fontWeightBold,
      color: theme.colors.text.primary,
    },
  }),
  button: css({
    marginTop: theme.spacing(2),
  }),
});
