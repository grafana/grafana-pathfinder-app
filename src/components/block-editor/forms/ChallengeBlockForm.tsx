/**
 * Challenge Block Form
 *
 * Form for creating/editing challenge blocks — CTF-style tasks run in a
 * Coda VM. Authors specify a VM template, optional setup commands that
 * configure the broken state, a success criterion (a requirement string),
 * and any progressive hints to reveal.
 */

import React, { useState, useCallback } from 'react';
import { Button, Field, Input, Combobox, TextArea, useStyles2, type ComboboxOption } from '@grafana/ui';
import { getBlockFormStyles } from '../block-editor.styles';
import { TypeSwitchDropdown } from './TypeSwitchDropdown';
import { testIds } from '../../../constants/testIds';
import type { BlockFormProps, JsonBlock } from '../types';
import type { JsonChallengeBlock, JsonChallengeHint } from '../../../types/json-guide.types';

const VM_TEMPLATE_OPTIONS: Array<ComboboxOption<string>> = [
  { label: 'Default (vm-aws)', value: '' },
  { label: 'Sample app (vm-aws-sample-app)', value: 'vm-aws-sample-app' },
  { label: 'Alloy scenario (vm-aws-alloy-scenario)', value: 'vm-aws-alloy-scenario' },
];

function isChallengeBlock(block: JsonBlock): block is JsonChallengeBlock {
  return block.type === 'challenge';
}

function linesFromArray(items: string[] | undefined): string {
  return items ? items.join('\n') : '';
}

function linesFromHints(hints: JsonChallengeHint[] | undefined): string {
  return hints ? hints.map((h) => h.text).join('\n') : '';
}

function arrayFromLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function hintsFromLines(text: string): JsonChallengeHint[] {
  return arrayFromLines(text).map((text) => ({ text }));
}

export function ChallengeBlockForm({
  initialData,
  onSubmit,
  onCancel,
  isEditing = false,
  onSwitchBlockType,
}: BlockFormProps) {
  const styles = useStyles2(getBlockFormStyles);

  const initial = initialData && isChallengeBlock(initialData) ? initialData : null;

  const [title, setTitle] = useState(initial?.title ?? '');
  const [brief, setBrief] = useState(initial?.brief ?? '');
  const [vmTemplate, setVmTemplate] = useState(initial?.vmTemplate ?? '');
  const [vmScenario, setVmScenario] = useState(initial?.vmScenario ?? '');
  const [vmApp, setVmApp] = useState(initial?.vmApp ?? '');
  const [setupText, setSetupText] = useState(linesFromArray(initial?.setupCommands));
  const [successCriteria, setSuccessCriteria] = useState(initial?.successCriteria ?? '');
  const [hintsText, setHintsText] = useState(linesFromHints(initial?.hintLevels));
  const [failureMessage, setFailureMessage] = useState(initial?.failureMessage ?? '');

  const isAlloyScenario = vmTemplate === 'vm-aws-alloy-scenario';
  const isSampleApp = vmTemplate === 'vm-aws-sample-app';

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      const setupCommands = arrayFromLines(setupText);
      const hintLevels = hintsFromLines(hintsText);

      const block: JsonChallengeBlock = {
        type: 'challenge',
        title: title.trim(),
        brief: brief.trim(),
        successCriteria: successCriteria.trim(),
        ...(vmTemplate.trim() && { vmTemplate: vmTemplate.trim() }),
        ...(vmScenario.trim() && { vmScenario: vmScenario.trim() }),
        ...(vmApp.trim() && { vmApp: vmApp.trim() }),
        ...(setupCommands.length > 0 && { setupCommands }),
        ...(hintLevels.length > 0 && { hintLevels }),
        ...(failureMessage.trim() && { failureMessage: failureMessage.trim() }),
      };

      onSubmit(block as JsonBlock);
    },
    [title, brief, vmTemplate, vmScenario, vmApp, setupText, successCriteria, hintsText, failureMessage, onSubmit]
  );

  const isValid = title.trim().length > 0 && brief.trim().length > 0 && successCriteria.trim().length > 0;

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <Field label="Title" description="Short heading shown above the brief" required>
        <Input
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          placeholder="Fix the broken Prometheus scrape"
        />
      </Field>

      <Field label="Brief" description="Markdown problem statement explaining what the user needs to do" required>
        <TextArea
          value={brief}
          onChange={(e) => setBrief(e.currentTarget.value)}
          placeholder="Alloy is misconfigured so metrics never reach Prometheus. Diagnose and restore collection."
          rows={4}
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

      {isAlloyScenario && (
        <Field label="Scenario" description="Alloy scenario to run on the VM">
          <Input value={vmScenario} onChange={(e) => setVmScenario(e.currentTarget.value)} />
        </Field>
      )}

      {isSampleApp && (
        <Field label="App name" description="Sample app to deploy on the VM">
          <Input value={vmApp} onChange={(e) => setVmApp(e.currentTarget.value)} />
        </Field>
      )}

      <Field
        label="Setup commands"
        description="Bash commands run sequentially before the challenge starts. One per line. A readiness sentinel is written automatically after these succeed."
      >
        <TextArea
          value={setupText}
          onChange={(e) => setSetupText(e.currentTarget.value)}
          placeholder={'sudo systemctl stop alloy\nsudo sed -i "s/9090/9091/" /etc/alloy/config.alloy'}
          rows={4}
        />
      </Field>

      <Field
        label="Success criterion"
        description="Requirement evaluated when the user clicks Check my work (typically coda-exit-zero:<command>)"
        required
      >
        <Input
          value={successCriteria}
          onChange={(e) => setSuccessCriteria(e.currentTarget.value)}
          placeholder='coda-exit-zero:curl -sf "localhost:9090/api/v1/query?query=up" | jq -e ".data.result | length > 0"'
        />
      </Field>

      <Field
        label="Hint levels"
        description="Progressive hints revealed one per click. One hint per line; first is the gentlest, last is the most explicit."
      >
        <TextArea
          value={hintsText}
          onChange={(e) => setHintsText(e.currentTarget.value)}
          placeholder={
            'Check whether Alloy is running.\nLook at /etc/alloy/config.alloy for the scrape target.\nRevert the port to 9090 and restart Alloy.'
          }
          rows={4}
        />
      </Field>

      <Field label="Failure message" description="Shown when the success check fails (optional)">
        <Input
          value={failureMessage}
          onChange={(e) => setFailureMessage(e.currentTarget.value)}
          placeholder="Metrics are not flowing yet. Try the next hint."
        />
      </Field>

      <div className={styles.footer}>
        {isEditing && onSwitchBlockType && (
          <div className={styles.footerLeft}>
            <TypeSwitchDropdown currentType="challenge" onSwitch={onSwitchBlockType} blockData={initialData} />
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
