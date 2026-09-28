/**
 * Terminal Connect Block Form
 *
 * Form for creating/editing terminal connect blocks.
 * These blocks render a "Try in terminal" button that opens
 * and connects to the Coda terminal.
 */

import React, { useState, useCallback } from 'react';
import { Alert, Button, Checkbox, Field, Input, Combobox, TextArea, useStyles2 } from '@grafana/ui';
import { getBlockFormStyles } from '../block-editor.styles';
import { TypeSwitchDropdown } from './TypeSwitchDropdown';
import { useCodaOptions, useCodaTemplateOptions } from './useCodaOptions';
import { testIds } from '../../../constants/testIds';
import type { BlockFormProps, JsonBlock } from '../types';
import type { JsonTerminalConnectBlock } from '../../../types/json-guide.types';

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
  const [gcx, setGcx] = useState(initial?.gcx ?? false);

  const isSampleApp = vmTemplate === 'vm-aws-sample-app';
  const isAlloyScenario = vmTemplate === 'vm-aws-alloy-scenario';
  const {
    options: sampleAppOptions,
    isLoading: isLoadingApps,
    unavailable: appsUnavailable,
  } = useCodaOptions(isSampleApp, 'sampleApps');
  const {
    options: scenarioOptions,
    isLoading: isLoadingScenarios,
    unavailable: scenariosUnavailable,
  } = useCodaOptions(isAlloyScenario, 'alloyScenarios');
  const { options: templateOptions, isLoading: templatesLoading } = useCodaTemplateOptions(vmTemplate);

  const handleSubmit = useCallback(
    (e: React.SubmitEvent) => {
      e.preventDefault();

      const block: JsonTerminalConnectBlock = {
        type: 'terminal-connect',
        content: content.trim(),
        ...(buttonText.trim() && { buttonText: buttonText.trim() }),
        ...(vmTemplate.trim() && { vmTemplate: vmTemplate.trim() }),
        ...(vmApp.trim() && { vmApp: vmApp.trim() }),
        ...(vmScenario.trim() && { vmScenario: vmScenario.trim() }),
        ...(gcx && { gcx: true }),
      };

      onSubmit(block as JsonBlock);
    },
    [content, buttonText, vmTemplate, vmApp, vmScenario, gcx, onSubmit]
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
          options={templateOptions}
          loading={templatesLoading}
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
            placeholder={appsUnavailable ? 'Coda unavailable — type an app id' : 'Select a sample app...'}
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
            placeholder={scenariosUnavailable ? 'Coda unavailable — type a scenario id' : 'Select a scenario...'}
            isClearable
          />
        </Field>
      )}

      <Checkbox
        label="Set up gcx"
        description="Also install a Grafana credential in the VM, so the gcx CLI can talk to this Grafana as the learner. Minting one needs an admin; everyone else pastes a service account token."
        value={gcx}
        onChange={(e) => setGcx(e.currentTarget.checked)}
      />

      {gcx && (
        <Alert title="gcx is not stored on the backend yet" severity="warning">
          The <code>InteractiveGuide</code> resource does not declare this field, so saving or publishing this guide
          drops it without an error and the step reloads without it. Serve the guide from a bundled package or a local
          file until the backend declares <code>gcx</code>.
        </Alert>
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
        <Button variant="secondary" onClick={onCancel} data-testid={testIds.blockEditor.formCancelButton}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
