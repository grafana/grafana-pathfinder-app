import React, { useEffect, useId, useRef, useState } from 'react';
import { Alert, Button, Field, FieldSet, Stack, Text } from '@grafana/ui';
import { config } from '@grafana/runtime';
import { currentPlatform } from '../../lib/platform';
import type { CustomGuideRepositoryEntry } from '../../lib/custom-guide-repository-client';
import { fetchBackendGuides } from '../../utils/fetchBackendGuides';
import { loadMyCompletions } from '../../completion-records/completion-read-client';
import { resolveOrganizationGuide } from '../../integrations/organization-guide/resolve';
import { usePathfinderPluginConfig, publishPathfinderPluginConfig } from '../../hooks';
import { fetchPathfinderSettingsSnapshot } from '../../utils/pathfinder-settings-api';
import { saveTenantSettings } from '../AppConfig/save-settings';
import pluginJson from '../../plugin.json';

function SettingsForm() {
  const inputId = useId();
  const mounted = useRef(true);
  const { config: settings, isResolved, hasError } = usePathfinderPluginConfig({ refreshOnMount: true });
  const [choices, setChoices] = useState<CustomGuideRepositoryEntry[]>([]);
  const [available, setAvailable] = useState(false);
  const [selection, setSelection] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string }>();
  const selected = selection ?? settings.organizationGuideId;
  useEffect(() => {
    let cancelled = false;
    mounted.current = true;
    void Promise.all([fetchBackendGuides(config.namespace, true), loadMyCompletions()])
      .then(([catalogue, completions]) => {
        if (!cancelled) {
          setAvailable(completions.kind === 'ok');
          setChoices(
            catalogue
              .filter(
                (guide) =>
                  typeof guide.metadata?.name === 'string' &&
                  guide.metadata.name &&
                  guide.spec?.status === 'published' &&
                  (!guide.spec.manifest?.type || guide.spec.manifest.type === 'guide')
              )
              .map((guide) => ({ id: guide.metadata.name, title: guide.spec.title }))
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAvailable(false);
        }
      });
    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, []);

  async function save(event: React.SubmitEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(undefined);
    try {
      if (selected && (!available || !(await resolveOrganizationGuide(selected)))) {
        throw new Error('Select a valid published organization guide.');
      }
      await saveTenantSettings({ pluginId: pluginJson.id, changes: { organizationGuideId: selected } });
      const snapshot = await fetchPathfinderSettingsSnapshot();
      if (snapshot?.config.organizationGuideId !== selected) {
        throw new Error('Could not verify the saved selection.');
      }
      if (!mounted.current) {
        return;
      }
      publishPathfinderPluginConfig({ ...settings, ...snapshot.config });
      setMessage({ error: false, text: 'Organization guide saved. The change applies on the next page load.' });
    } catch {
      if (!mounted.current) {
        return;
      }
      setMessage({
        error: true,
        text: 'Could not save the organization guide. Your selection is retained. Check that the guide is published and the settings service is available, then retry.',
      });
    } finally {
      if (mounted.current) {
        setSaving(false);
      }
    }
  }

  return (
    <form onSubmit={save}>
      <FieldSet label="Organization guide">
        <Stack direction="column" gap={2}>
          <Text element="p">
            Select one published guide for this Cloud instance. This applies to existing users as well as newcomers who
            have no matching completion. It never blocks access to Grafana.
          </Text>
          <Text element="p">
            The guide can open automatically up to three times in each browser, at least 24 hours apart. Users can
            choose Not now and return through the Organization guide entry. Editing the same guide does not re-prompt
            completed users; select a new guide identity for new guidance.
          </Text>
          {!available && (
            <Alert severity="info" title="Published guides and completion records must be available to select a guide">
              You can still clear an existing selection.
            </Alert>
          )}
          <Field label="Published organization guide" htmlFor={inputId}>
            <select
              id={inputId}
              value={selected}
              disabled={!isResolved || hasError || saving}
              onChange={(event) => {
                setSelection(event.target.value);
                setMessage(undefined);
              }}
            >
              <option value="">None</option>
              {selected && !choices.some((guide) => guide.id === selected) && (
                <option value={selected} disabled>
                  Current selection (unavailable)
                </option>
              )}
              {choices.map((guide) => (
                <option key={guide.id} value={guide.id} disabled={!available}>
                  {guide.title || guide.id}
                </option>
              ))}
            </select>
          </Field>
          <Button type="submit" disabled={!isResolved || hasError || saving || (Boolean(selected) && !available)}>
            {saving ? 'Saving…' : 'Save organization guide'}
          </Button>
          {message && <Alert severity={message.error ? 'error' : 'success'} title={message.text} />}
          <Text element="p">
            Learning insights shows recorded completions, not proof that every statement was acknowledged or understood.
            Keep the guide brief and link to detailed policies.
          </Text>
        </Stack>
      </FieldSet>
    </form>
  );
}

export function OrganizationGuideSettings() {
  return currentPlatform() === 'cloud' && config.bootData?.user?.orgRole === 'Admin' ? <SettingsForm /> : null;
}
