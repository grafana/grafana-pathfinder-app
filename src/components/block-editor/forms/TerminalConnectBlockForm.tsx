/**
 * Terminal Connect Block Form
 *
 * Form for creating/editing terminal connect blocks.
 * These blocks render a "Try in terminal" button that opens
 * and connects to the Coda terminal.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Button, Field, Input, Combobox, TextArea, useStyles2, type ComboboxOption } from '@grafana/ui';
import { getBackendSrv } from '@grafana/runtime';
import { getBlockFormStyles } from '../block-editor.styles';
import { TypeSwitchDropdown } from './TypeSwitchDropdown';
import type { BlockFormProps, JsonBlock } from '../types';
import type { JsonTerminalConnectBlock } from '../../../types/json-guide.types';
import { PLUGIN_BACKEND_URL } from '../../../constants';

const VM_TEMPLATE_OPTIONS: Array<ComboboxOption<string>> = [
  { label: 'Default (vm-aws)', value: '' },
  { label: 'Sample app (vm-aws-sample-app)', value: 'vm-aws-sample-app' },
  { label: 'Alloy scenario (vm-aws-alloy-scenario)', value: 'vm-aws-alloy-scenario' },
];

interface CodaListItem {
  id: string;
  name: string;
  description: string;
  status: string;
}

/**
 * Generic hook for fetching Coda list endpoints (sample apps, alloy scenarios, etc.).
 * @param enabled  Whether the fetch should be active
 * @param url      Backend URL to fetch from
 * @param key      Response key that holds the array (e.g. "apps", "scenarios")
 */
function useCodaOptions(enabled: boolean, url: string, key: string) {
  const [options, setOptions] = useState<Array<ComboboxOption<string>>>([]);
  const [done, setDone] = useState(false);
  const [prevEnabled, setPrevEnabled] = useState(enabled);

  if (enabled !== prevEnabled) {
    setPrevEnabled(enabled);
    if (enabled) {
      setDone(false);
    }
  }

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const sub = getBackendSrv()
      .fetch<Record<string, CodaListItem[]>>({ url })
      .subscribe({
        next(resp) {
          const items = resp?.data?.[key];
          if (items) {
            setOptions(
              items.map((item) => ({
                label: item.name,
                value: item.id,
                description: item.description,
              }))
            );
          }
          setDone(true);
        },
        error() {
          setDone(true);
        },
      });

    return () => sub.unsubscribe();
  }, [enabled, url, key]);

  return { options, isLoading: enabled && !done };
}

function isTerminalConnectBlock(block: JsonBlock): block is JsonTerminalConnectBlock {
  return block.type === 'terminal-connect';
}

export function TerminalConnectBlockForm({
  initialData,
  onSubmit,
  onCancel,
  isEditing = false,
  onSwitchBlockType,
}: BlockFormProps) {
  const styles = useStyles2(getBlockFormStyles);

  const initial = initialData && isTerminalConnectBlock(initialData) ? initialData : null;

  const [content, setContent] = useState(initial?.content ?? '');
  const [buttonText, setButtonText] = useState(initial?.buttonText ?? '');
  const [vmTemplate, setVmTemplate] = useState(initial?.vmTemplate ?? '');
  const [vmApp, setVmApp] = useState(initial?.vmApp ?? '');
  const [vmScenario, setVmScenario] = useState(initial?.vmScenario ?? '');

  const isSampleApp = vmTemplate === 'vm-aws-sample-app';
  const isAlloyScenario = vmTemplate === 'vm-aws-alloy-scenario';
  const { options: sampleAppOptions, isLoading: isLoadingApps } = useCodaOptions(
    isSampleApp,
    `${PLUGIN_BACKEND_URL}/sample-apps`,
    'apps'
  );
  const { options: scenarioOptions, isLoading: isLoadingScenarios } = useCodaOptions(
    isAlloyScenario,
    `${PLUGIN_BACKEND_URL}/alloy-scenarios`,
    'scenarios'
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      const block: JsonTerminalConnectBlock = {
        type: 'terminal-connect',
        content: content.trim(),
        ...(buttonText.trim() && { buttonText: buttonText.trim() }),
        ...(vmTemplate.trim() && { vmTemplate: vmTemplate.trim() }),
        ...(vmApp.trim() && { vmApp: vmApp.trim() }),
        ...(vmScenario.trim() && { vmScenario: vmScenario.trim() }),
      };

      onSubmit(block as JsonBlock);
    },
    [content, buttonText, vmTemplate, vmApp, vmScenario, onSubmit]
  );

  const isValid = content.trim().length > 0;

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <Field label="Description" description="Markdown description shown above the connect button" required>
        <TextArea
          value={content}
          onChange={(e) => setContent(e.currentTarget.value)}
          placeholder="Click the button below to connect to a terminal session where you can run commands..."
          rows={3}
        />
      </Field>

      <Field label="Button text" description="Custom button label (defaults to 'Try in terminal')">
        <Input
          value={buttonText}
          onChange={(e) => setButtonText(e.currentTarget.value)}
          placeholder="Try in terminal"
        />
      </Field>

      <Field label="VM template" description="VM template to provision (defaults to vm-aws)">
        <Combobox
          options={VM_TEMPLATE_OPTIONS}
          value={vmTemplate}
          onChange={(opt) => {
            setVmTemplate(opt.value);
            if (!opt.value || opt.value === 'vm-aws-alloy-scenario') {
              setVmApp('');
            }
            if (!opt.value || opt.value !== 'vm-aws-alloy-scenario') {
              setVmScenario('');
            }
          }}
        />
      </Field>

      {isSampleApp && (
        <Field label="App name" description="Sample app to deploy on the VM">
          <Combobox
            options={sampleAppOptions}
            value={vmApp || null}
            onChange={(opt) => setVmApp(opt?.value ?? '')}
            loading={isLoadingApps}
            createCustomValue
            placeholder="Select a sample app..."
            isClearable
          />
        </Field>
      )}

      {isAlloyScenario && (
        <Field label="Scenario" description="Alloy scenario to run on the VM">
          <Combobox
            options={scenarioOptions}
            value={vmScenario || null}
            onChange={(opt) => setVmScenario(opt?.value ?? '')}
            loading={isLoadingScenarios}
            createCustomValue
            placeholder="Select a scenario..."
            isClearable
          />
        </Field>
      )}

      <div className={styles.footer}>
        {isEditing && onSwitchBlockType && (
          <div className={styles.footerLeft}>
            <TypeSwitchDropdown currentType="terminal-connect" onSwitch={onSwitchBlockType} blockData={initialData} />
          </div>
        )}
        <Button type="submit" disabled={!isValid}>
          {isEditing ? 'Update' : 'Add'} block
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
