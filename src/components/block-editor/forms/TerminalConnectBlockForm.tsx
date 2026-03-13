/**
 * Terminal Connect Block Form
 *
 * Form for creating/editing terminal connect blocks.
 * These blocks render a "Try in terminal" button that opens
 * and connects to the Coda terminal.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Button, Field, Input, Select, TextArea, useStyles2 } from '@grafana/ui';
import { SelectableValue } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { getBlockFormStyles } from '../block-editor.styles';
import { TypeSwitchDropdown } from './TypeSwitchDropdown';
import type { BlockFormProps, JsonBlock } from '../types';
import type { JsonTerminalConnectBlock } from '../../../types/json-guide.types';
import { PLUGIN_BACKEND_URL } from '../../../constants';

const VM_TEMPLATE_OPTIONS: Array<SelectableValue<string>> = [
  { label: 'Default (vm-aws)', value: '' },
  { label: 'Sample app (vm-aws-sample-app)', value: 'vm-aws-sample-app' },
];

interface SampleApp {
  id: string;
  name: string;
  description: string;
  status: string;
}

function useSampleApps(enabled: boolean) {
  const [options, setOptions] = useState<Array<SelectableValue<string>>>([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset loading state when re-entering sample app mode
    setDone(false);

    const sub = getBackendSrv()
      .fetch<{ apps: SampleApp[] }>({ url: `${PLUGIN_BACKEND_URL}/sample-apps` })
      .subscribe({
        next(resp) {
          if (resp?.data?.apps) {
            setOptions(
              resp.data.apps.map((app) => ({
                label: app.name,
                value: app.id,
                description: app.description,
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
  }, [enabled]);

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

  const isSampleApp = vmTemplate === 'vm-aws-sample-app';
  const { options: sampleAppOptions, isLoading: isLoadingApps } = useSampleApps(isSampleApp);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      const block: JsonTerminalConnectBlock = {
        type: 'terminal-connect',
        content: content.trim(),
        ...(buttonText.trim() && { buttonText: buttonText.trim() }),
        ...(vmTemplate.trim() && { vmTemplate: vmTemplate.trim() }),
        ...(vmApp.trim() && { vmApp: vmApp.trim() }),
      };

      onSubmit(block as JsonBlock);
    },
    [content, buttonText, vmTemplate, vmApp, onSubmit]
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
        <Select
          options={VM_TEMPLATE_OPTIONS}
          value={VM_TEMPLATE_OPTIONS.find((o) => o.value === vmTemplate) ?? VM_TEMPLATE_OPTIONS[0]}
          onChange={(v) => {
            setVmTemplate(v.value ?? '');
            if (!v.value) {
              setVmApp('');
            }
          }}
        />
      </Field>

      {isSampleApp && (
        <Field label="App name" description="Sample app to deploy on the VM">
          <Select
            options={sampleAppOptions}
            value={
              sampleAppOptions.find((o) => o.value === vmApp) ?? (vmApp ? { label: vmApp, value: vmApp } : undefined)
            }
            onChange={(v) => setVmApp(v.value ?? '')}
            isLoading={isLoadingApps}
            allowCustomValue
            placeholder="Select a sample app..."
            noOptionsMessage="No apps available — check Coda registration"
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
