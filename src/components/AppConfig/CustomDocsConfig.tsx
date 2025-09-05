import React, { useState, ChangeEvent } from 'react';
import { Button, Field, Input, useStyles2, FieldSet, IconButton, Alert } from '@grafana/ui';
import { PluginConfigPageProps, AppPluginMeta, GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { testIds } from '../testIds';
import { DocsPluginConfig, CustomDocsRepo } from '../../constants';
import { updatePluginSettings } from '../../utils/utils.plugin';
import { useFeatureFlag, initializeFeatureFlags } from '../../utils/feature-flag.service';

type JsonData = DocsPluginConfig;

interface CustomDocsConfigProps extends PluginConfigPageProps<AppPluginMeta<JsonData>> {}

const CustomDocsConfig = ({ plugin }: CustomDocsConfigProps) => {
  const styles = useStyles2(getStyles);
  const { enabled, pinned, jsonData } = plugin.meta;

  // Initialize hooks first (before any early returns)
  const [customDocsRepos, setCustomDocsRepos] = useState<CustomDocsRepo[]>(jsonData?.customDocsRepos || []);
  const [isSaving, setIsSaving] = useState(false);

  // Check if custom docs feature is enabled (check both config and session)
  const configFeatures = plugin.meta.jsonData?.features || '';

  // Ensure feature flags are initialized when visiting this config page directly (root App may not be mounted)
  try {
    initializeFeatureFlags(configFeatures);
  } catch (e) {
    console.error('Failed to initialize feature flags in CustomDocsConfig:', e);
  }

  const isEnabledInConfig = configFeatures
    .split(',')
    .map((f) => f.trim())
    .includes('custom_docs');
  const isEnabledInSession = useFeatureFlag('custom_docs');
  const isCustomDocsEnabled = isEnabledInConfig || isEnabledInSession;

  // Show feature not available message if feature flag is disabled
  if (!isCustomDocsEnabled) {
    return (
      <FieldSet label="Custom Documentation Repositories" className={styles.fieldSet}>
        <Alert severity="info" title="Feature Not Available">
          <p>Custom documentation repositories is an experimental feature that is not yet available.</p>
          <p>
            This feature will allow you to configure custom GitHub repositories as documentation sources that integrate
            with Grafana&apos;s recommendation system.
          </p>
          <p>Contact your system administrator to enable this feature.</p>
        </Alert>
      </FieldSet>
    );
  }

  const addRepo = () => {
    const newRepo: CustomDocsRepo = {
      name: '',
      url: '',
      confidence: 1.0,
    };
    setCustomDocsRepos([...customDocsRepos, newRepo]);
  };

  const removeRepo = (index: number) => {
    const updatedRepos = customDocsRepos.filter((_, i) => i !== index);
    setCustomDocsRepos(updatedRepos);
  };

  const updateRepo = (index: number, field: keyof CustomDocsRepo, value: string | number) => {
    const updatedRepos = customDocsRepos.map((repo, i) => {
      if (i === index) {
        return { ...repo, [field]: value };
      }
      return repo;
    });
    setCustomDocsRepos(updatedRepos);
  };

  const onChangeRepoName = (index: number) => (event: ChangeEvent<HTMLInputElement>) => {
    updateRepo(index, 'name', event.target.value.trim());
  };

  const onChangeRepoUrl = (index: number) => (event: ChangeEvent<HTMLInputElement>) => {
    updateRepo(index, 'url', event.target.value.trim());
  };

  const onChangeRepoConfidence = (index: number) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(event.target.value);
    // Clamp between 0.0 and 1.0
    const clampedValue = Math.max(0.0, Math.min(1.0, isNaN(value) ? 0.0 : value));
    updateRepo(index, 'confidence', clampedValue);
  };

  const isSubmitDisabled = () => {
    // Check if any repo has empty name or invalid URL
    return customDocsRepos.some(
      (repo) => !repo.name.trim() || !repo.url.trim() || repo.confidence < 0 || repo.confidence > 1
    );
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);

    try {
      const newJsonData = {
        ...jsonData,
        customDocsRepos: customDocsRepos.filter((repo) => repo.name.trim() && repo.url.trim()),
      };

      await updatePluginSettings(plugin.meta.id, {
        enabled,
        pinned,
        jsonData: newJsonData,
      });

      // Reload to ensure fresh plugin context
      setTimeout(() => {
        try {
          window.location.reload();
        } catch (e) {
          console.error('Failed to reload page after saving custom docs configuration', e);
        }
      }, 100);
    } catch (error) {
      console.error('Error saving custom docs configuration:', error);
      setIsSaving(false);
      throw error;
    }
  };

  return (
    <form onSubmit={onSubmit}>
      <FieldSet label="Custom Documentation Repositories" className={styles.fieldSet}>
        <div className={styles.description}>
          Add custom documentation repositories that will be used as sources for documentation recommendations. Each
          repository should have a name, URL, and confidence score between 0.0 and 1.0.
        </div>

        {customDocsRepos.length === 0 && (
          <div className={styles.emptyState}>
            No custom documentation repositories configured. Click &quot;Add repository&quot; to get started.
          </div>
        )}

        {customDocsRepos.map((repo, index) => (
          <div key={index} className={styles.repoRow}>
            <div className={styles.repoFields}>
              <Field label="Name" className={styles.nameField}>
                <Input
                  placeholder="Repository name"
                  value={repo.name}
                  onChange={onChangeRepoName(index)}
                  data-testid={`${testIds.customDocs.repoName}-${index}`}
                />
              </Field>

              <Field label="URL" className={styles.urlField}>
                <Input
                  placeholder="https://docs.example.com"
                  value={repo.url}
                  onChange={onChangeRepoUrl(index)}
                  data-testid={`${testIds.customDocs.repoUrl}-${index}`}
                />
              </Field>

              <Field label="Confidence" className={styles.confidenceField}>
                <Input
                  type="number"
                  min="0"
                  max="1"
                  step="0.1"
                  placeholder="1.0"
                  value={repo.confidence.toString()}
                  onChange={onChangeRepoConfidence(index)}
                  data-testid={`${testIds.customDocs.repoConfidence}-${index}`}
                />
              </Field>
            </div>

            <div className={styles.removeButton}>
              <IconButton
                name="trash-alt"
                tooltip="Remove repository"
                onClick={() => removeRepo(index)}
                data-testid={`${testIds.customDocs.removeRepo}-${index}`}
              />
            </div>
          </div>
        ))}

        <div className={styles.addButton}>
          <Button variant="secondary" icon="plus" onClick={addRepo} data-testid={testIds.customDocs.addRepo}>
            Add repository
          </Button>
        </div>

        <div className={styles.submitButton}>
          <Button type="submit" disabled={isSubmitDisabled() || isSaving} data-testid={testIds.customDocs.submit}>
            {isSaving ? 'Saving...' : 'Save configuration'}
          </Button>
        </div>
      </FieldSet>
    </form>
  );
};

export default CustomDocsConfig;

const getStyles = (theme: GrafanaTheme2) => ({
  fieldSet: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
  }),
  description: css({
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing(2),
  }),
  emptyState: css({
    padding: theme.spacing(3),
    textAlign: 'center',
    color: theme.colors.text.secondary,
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px dashed ${theme.colors.border.weak}`,
  }),
  repoRow: css({
    display: 'flex',
    alignItems: 'flex-end',
    gap: theme.spacing(2),
    padding: theme.spacing(2),
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  repoFields: css({
    display: 'flex',
    flex: 1,
    gap: theme.spacing(2),
    alignItems: 'flex-end',
  }),
  nameField: css({
    flex: 2,
    minWidth: '200px',
  }),
  urlField: css({
    flex: 3,
    minWidth: '300px',
  }),
  confidenceField: css({
    flex: 1,
    minWidth: '100px',
  }),
  removeButton: css({
    display: 'flex',
    alignItems: 'center',
  }),
  addButton: css({
    marginTop: theme.spacing(2),
  }),
  submitButton: css({
    marginTop: theme.spacing(3),
  }),
});
