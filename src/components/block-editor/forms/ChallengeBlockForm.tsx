/**
 * Challenge Block Form
 *
 * Form for creating/editing challenge blocks — CTF-style tasks run in a
 * Coda VM. Authors specify a VM template, optional setup commands that
 * configure the broken state, a success criterion (a requirement string),
 * and any progressive hints to reveal.
 */

import React, { useState, useCallback } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import {
  Badge,
  Button,
  Combobox,
  Field,
  IconButton,
  Input,
  RadioButtonGroup,
  TextArea,
  useStyles2,
  type ComboboxOption,
} from '@grafana/ui';
import { getBlockFormStyles } from '../block-editor.styles';
import { ConditionChipsField } from './ConditionChipsField';
import { TypeSwitchDropdown } from './TypeSwitchDropdown';
import { useCodaOptions } from './useCodaOptions';
import { testIds } from '../../../constants/testIds';
import type { BlockFormProps, JsonBlock } from '../types';
import type { JsonChallengeBlock, JsonChallengeHint } from '../../../types/json-guide.types';
import { PLUGIN_BACKEND_URL } from '../../../constants';

const VM_TEMPLATE_OPTIONS: Array<ComboboxOption<string>> = [
  { label: 'Default (vm-aws)', value: '' },
  { label: 'Sample app (vm-aws-sample-app)', value: 'vm-aws-sample-app' },
  { label: 'Alloy scenario (vm-aws-alloy-scenario)', value: 'vm-aws-alloy-scenario' },
];

type ChallengeMode = 'standard' | 'coda';

const MODE_OPTIONS: Array<{ label: string; value: ChallengeMode; description?: string }> = [
  {
    label: 'Standard',
    value: 'standard',
    description: 'Verify against the learner’s own Grafana — no VM, no terminal.',
  },
  {
    label: 'Coda VM',
    value: 'coda',
    description: 'Provision a Coda VM with a terminal; verify with a shell command.',
  },
];

/**
 * Pick the mode for a block being edited. Explicit `mode` field wins. For
 * legacy blocks (no `mode` set) we infer from the presence of Coda-specific
 * fields: `vmTemplate`, `vmScenario`, `vmApp`, `setupScript`, `setupCommands`.
 * A brand-new block (no `initial`) defaults to 'standard' because that's the
 * cheaper, more typical authoring path.
 */
function inferInitialMode(block: JsonChallengeBlock | null): ChallengeMode {
  if (!block) {
    return 'standard';
  }
  if (block.mode) {
    return block.mode;
  }
  if (
    block.vmTemplate ||
    block.vmScenario ||
    block.vmApp ||
    block.setupScript ||
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- legacy detection
    (block.setupCommands && block.setupCommands.length > 0)
  ) {
    return 'coda';
  }
  // Legacy block with no Coda fields — default to Coda for safety, since the
  // historical behaviour was Coda-only and the success criterion is almost
  // certainly already shaped as `coda-exit-zero:...`.
  return 'coda';
}

/** Hint with a stable client-side ID used as React key during reorder. */
interface HintRow {
  id: string;
  text: string;
}

function isChallengeBlock(block: JsonBlock): block is JsonChallengeBlock {
  return block.type === 'challenge';
}

/**
 * Seed the setup-script field. Prefer the new field; migrate the legacy
 * array. Reads of `setupCommands` are intentional back-compat — this is the
 * migration path from the old shape to the new one.
 */
function seedSetupScript(block: JsonChallengeBlock | null): string {
  if (block?.setupScript != null) {
    return block.setupScript;
  }
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- intentional: migrating legacy field on edit
  if (block?.setupCommands && block.setupCommands.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- intentional: migrating legacy field on edit
    return block.setupCommands.join('\n');
  }
  return '';
}

function makeHintId(): string {
  // crypto.randomUUID is available in all modern browsers Pathfinder targets;
  // fall back to a sufficiently-unique string in case of an unusual env.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `hint-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function toHintRows(hints: JsonChallengeHint[] | undefined): HintRow[] {
  return (hints ?? []).map((h) => ({ id: makeHintId(), text: h.text }));
}

const getChallengeFormStyles = (theme: GrafanaTheme2) => ({
  setupScriptInput: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  successCritDescription: css({
    '& code': {
      fontFamily: theme.typography.fontFamilyMonospace,
      fontSize: theme.typography.bodySmall.fontSize,
      backgroundColor: theme.colors.background.secondary,
      padding: `0 ${theme.spacing(0.5)}`,
      borderRadius: theme.shape.radius.default,
    },
    '& ul': {
      margin: `${theme.spacing(0.5)} 0 0 0`,
      paddingLeft: theme.spacing(2),
    },
    '& li': {
      marginBottom: theme.spacing(0.25),
    },
  }),
  hintList: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  }),
  hintRow: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    backgroundColor: theme.colors.background.secondary,
  }),
  hintBadge: css({
    minWidth: '56px',
    textAlign: 'center',
    flexShrink: 0,
  }),
  hintInput: css({
    flex: 1,
  }),
  hintActions: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.25),
    flexShrink: 0,
  }),
  addHintButton: css({
    alignSelf: 'flex-start',
    marginTop: theme.spacing(0.5),
  }),
  emptyHints: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    fontStyle: 'italic',
    padding: theme.spacing(1),
  }),
  successCheckInput: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  commaWarning: css({
    marginTop: theme.spacing(0.5),
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.warning.text,
  }),
});

const SUCCESS_CHECK_PREFIX = 'coda-exit-zero:';

/** Strip a leading `coda-exit-zero:` from a stored requirement so the form
 *  can display just the bash command. Leaves other requirement strings
 *  (e.g. hand-written `has-datasource:prometheus`) untouched — those are
 *  edge cases best resolved by hand-editing the JSON. */
function stripSuccessPrefix(criteria: string | undefined): string {
  if (!criteria) {
    return '';
  }
  return criteria.startsWith(SUCCESS_CHECK_PREFIX) ? criteria.slice(SUCCESS_CHECK_PREFIX.length) : criteria;
}

export function ChallengeBlockForm({
  initialData,
  onSubmit,
  onCancel,
  isEditing = false,
  onSwitchBlockType,
}: BlockFormProps) {
  const styles = useStyles2(getBlockFormStyles);
  const challengeStyles = useStyles2(getChallengeFormStyles);

  const initial = initialData && isChallengeBlock(initialData) ? initialData : null;

  const [mode, setMode] = useState<ChallengeMode>(() => inferInitialMode(initial));
  const [title, setTitle] = useState(initial?.title ?? '');
  const [brief, setBrief] = useState(initial?.brief ?? '');
  const [vmTemplate, setVmTemplate] = useState(initial?.vmTemplate ?? '');
  const [vmScenario, setVmScenario] = useState(initial?.vmScenario ?? '');
  const [vmApp, setVmApp] = useState(initial?.vmApp ?? '');
  const [setupScript, setSetupScript] = useState(() => seedSetupScript(initial));
  // In Coda mode the form stores the bare bash command (no `coda-exit-zero:`
  // prefix). The form strips on open + prepends on submit so the JSON shape
  // and requirements pipeline stay unchanged. In standard mode the field is
  // a literal requirement string (e.g. `has-dashboard-named:My Dashboard`)
  // and no prefix logic runs. The initial value is derived once based on
  // the inferred initial mode; subsequent mode toggles do NOT mutate the
  // field (we don't want to silently destroy the author's input).
  const [successCommand, setSuccessCommand] = useState(() => {
    const raw = initial?.successCriteria ?? '';
    return inferInitialMode(initial) === 'coda' ? stripSuccessPrefix(raw) : raw;
  });
  const [hints, setHints] = useState<HintRow[]>(() => toHintRows(initial?.hintLevels));
  const [failureMessage, setFailureMessage] = useState(initial?.failureMessage ?? '');

  const isAlloyScenario = vmTemplate === 'vm-aws-alloy-scenario';
  const isSampleApp = vmTemplate === 'vm-aws-sample-app';

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

  const handleAddHint = useCallback(() => {
    setHints((prev) => [...prev, { id: makeHintId(), text: '' }]);
  }, []);

  const handleRemoveHint = useCallback((id: string) => {
    setHints((prev) => prev.filter((h) => h.id !== id));
  }, []);

  const handleHintTextChange = useCallback((id: string, text: string) => {
    setHints((prev) => prev.map((h) => (h.id === id ? { ...h, text } : h)));
  }, []);

  const handleMoveHint = useCallback((id: string, direction: -1 | 1) => {
    setHints((prev) => {
      const idx = prev.findIndex((h) => h.id === id);
      const target = idx + direction;
      if (idx < 0 || target < 0 || target >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const a = next[idx]!;
      const b = next[target]!;
      next[idx] = b;
      next[target] = a;
      return next;
    });
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      const trimmedScript = setupScript.trim();
      const trimmedCommand = successCommand.trim();
      // Re-attach the coda-exit-zero prefix on submit ONLY in Coda mode.
      // Authors see the bare command in the form; the stored requirement
      // string keeps its canonical form so the requirements router can
      // dispatch it. In standard mode the criterion is already a literal
      // requirement string (e.g. `has-dashboard-named:Foo`) so we emit
      // it verbatim.
      const storedCriteria =
        mode === 'coda'
          ? trimmedCommand.startsWith(SUCCESS_CHECK_PREFIX)
            ? trimmedCommand
            : `${SUCCESS_CHECK_PREFIX}${trimmedCommand}`
          : trimmedCommand;
      const hintLevels: JsonChallengeHint[] = hints
        .map((h) => ({ text: h.text.trim() }))
        .filter((h) => h.text.length > 0);

      // Form always emits setupScript (never setupCommands) — when an
      // existing block had legacy setupCommands, the field was seeded with
      // them joined on newlines, so the migration happens transparently
      // on first save. In standard mode, Coda-specific fields are dropped
      // entirely from the output regardless of what's in component state
      // (so toggling modes mid-edit doesn't leak stale fields).
      const isCoda = mode === 'coda';
      const block: JsonChallengeBlock = {
        type: 'challenge',
        mode,
        title: title.trim(),
        brief: brief.trim(),
        successCriteria: storedCriteria,
        ...(isCoda && vmTemplate.trim() && { vmTemplate: vmTemplate.trim() }),
        ...(isCoda && vmScenario.trim() && { vmScenario: vmScenario.trim() }),
        ...(isCoda && vmApp.trim() && { vmApp: vmApp.trim() }),
        ...(isCoda && trimmedScript.length > 0 && { setupScript: trimmedScript }),
        ...(hintLevels.length > 0 && { hintLevels }),
        ...(failureMessage.trim() && { failureMessage: failureMessage.trim() }),
      };

      onSubmit(block as JsonBlock);
    },
    [mode, title, brief, vmTemplate, vmScenario, vmApp, setupScript, successCommand, hints, failureMessage, onSubmit]
  );

  const isValid = title.trim().length > 0 && brief.trim().length > 0 && successCommand.trim().length > 0;
  const successCommandHasComma = successCommand.includes(',');

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      {/* ===== Challenge content ===== */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Challenge content</div>

        <Field
          label="Mode"
          description={
            mode === 'standard'
              ? 'Verifies against the learner’s own Grafana via a Pathfinder requirement. No VM, no terminal.'
              : 'Provisions a Coda VM with a terminal; verifies with a shell command (coda-exit-zero).'
          }
        >
          <RadioButtonGroup options={MODE_OPTIONS} value={mode} onChange={(v) => setMode(v)} fullWidth />
        </Field>

        <Field label="Title" description="Short heading shown above the brief" required>
          <Input
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
            placeholder={mode === 'standard' ? 'Create your first dashboard' : 'Fix the broken Prometheus scrape'}
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
      </div>

      {/* ===== Environment (Coda mode only) ===== */}
      {mode === 'coda' && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Environment</div>

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

          <Field
            label="Setup script"
            description="Bash script run on the VM before the challenge starts. Multi-line is fine — use heredocs, control flow, whatever. A readiness sentinel is written automatically after this completes."
          >
            <TextArea
              value={setupScript}
              onChange={(e) => setSetupScript(e.currentTarget.value)}
              placeholder={
                'sudo systemctl stop alloy\nsudo sed -i "s/9090/9091/" /etc/alloy/config.alloy\nsudo systemctl start alloy'
              }
              rows={8}
              className={challengeStyles.setupScriptInput}
            />
          </Field>
        </div>
      )}

      {/* ===== Verification ===== */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Verification</div>

        <Field
          label="Success check"
          description={
            <div className={challengeStyles.successCritDescription}>
              {mode === 'coda' ? (
                <>
                  <div>
                    Bash command run inside the VM when the user clicks <em>Check my work</em>. The challenge is
                    considered solved when this exits 0. Common patterns:
                  </div>
                  <ul>
                    <li>
                      File exists — <code>test -f /path/to/file</code>
                    </li>
                    <li>
                      File contains a string — <code>grep -q &quot;pattern&quot; /path/to/file</code>
                    </li>
                    <li>
                      Service responds — <code>curl -sf http://localhost:PORT/path</code>
                    </li>
                    <li>
                      Process running — <code>pgrep -x process-name</code>
                    </li>
                  </ul>
                </>
              ) : (
                <div>
                  Pathfinder requirement that proves the challenge is solved. Multiple chips mean &quot;all must
                  pass&quot;.
                </div>
              )}
            </div>
          }
          required
        >
          <div>
            {mode === 'coda' ? (
              <>
                <TextArea
                  value={successCommand}
                  onChange={(e) => {
                    // If the user pastes a value that still has the
                    // coda-exit-zero prefix, silently strip it so internal
                    // state is always the bare command.
                    const next = e.currentTarget.value;
                    setSuccessCommand(
                      next.startsWith(SUCCESS_CHECK_PREFIX) ? next.slice(SUCCESS_CHECK_PREFIX.length) : next
                    );
                  }}
                  placeholder='curl -sf "localhost:9090/api/v1/query?query=up" | jq -e ".data.result | length > 0"'
                  rows={3}
                  className={challengeStyles.successCheckInput}
                />
                {successCommandHasComma && (
                  <div className={challengeStyles.commaWarning}>
                    ⚠ Commas in a success check are interpreted as requirement separators by the requirements pipeline
                    and will split this into multiple checks. Avoid commas in the command itself.
                  </div>
                )}
              </>
            ) : (
              // Standard mode uses the same chip-based requirements editor
              // every other interactive block uses — pick from a typed list,
              // get per-prefix helpers (semver, datasource picker, etc.),
              // see auto-recoverable indication, toggle to raw if needed.
              // Multiple chips = "all must pass" (the requirements router
              // already supports this; the field's comma-separated output
              // flows through unchanged).
              <ConditionChipsField
                value={successCommand}
                onChange={setSuccessCommand}
                mode="verify"
                testId="challenge-success-check"
              />
            )}
          </div>
        </Field>

        <Field
          label="Hint levels"
          description="Progressive hints revealed one per click. First is the gentlest, last is the most explicit. Use the arrows to reorder."
        >
          <div>
            {hints.length === 0 ? (
              <div className={challengeStyles.emptyHints}>No hints yet — authors don&apos;t have to provide any.</div>
            ) : (
              <div className={challengeStyles.hintList}>
                {hints.map((hint, index) => (
                  <div key={hint.id} className={challengeStyles.hintRow}>
                    <Badge text={`Hint ${index + 1}`} color="blue" className={challengeStyles.hintBadge} />
                    <div className={challengeStyles.hintInput}>
                      <Input
                        value={hint.text}
                        onChange={(e) => handleHintTextChange(hint.id, e.currentTarget.value)}
                        placeholder={`Hint ${index + 1} text`}
                        aria-label={`Hint ${index + 1} text`}
                      />
                    </div>
                    <div className={challengeStyles.hintActions}>
                      <IconButton
                        name="arrow-up"
                        tooltip={`Move hint ${index + 1} up`}
                        disabled={index === 0}
                        onClick={() => handleMoveHint(hint.id, -1)}
                      />
                      <IconButton
                        name="arrow-down"
                        tooltip={`Move hint ${index + 1} down`}
                        disabled={index === hints.length - 1}
                        onClick={() => handleMoveHint(hint.id, 1)}
                      />
                      <IconButton
                        name="trash-alt"
                        tooltip={`Remove hint ${index + 1}`}
                        onClick={() => handleRemoveHint(hint.id)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Button
              type="button"
              variant="secondary"
              icon="plus"
              size="sm"
              onClick={handleAddHint}
              className={challengeStyles.addHintButton}
            >
              Add hint
            </Button>
          </div>
        </Field>

        <Field
          label="Message shown when Check my work fails"
          description="Displayed alongside the next hint when verification fails. If empty, the block shows a generic 'Not solved yet' message."
        >
          <Input
            value={failureMessage}
            onChange={(e) => setFailureMessage(e.currentTarget.value)}
            placeholder="Metrics are not flowing yet. Try the next hint."
          />
        </Field>
      </div>

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
