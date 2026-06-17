/**
 * `ConditionChipsField` — structured editor for requirements / objectives.
 *
 * Replaces the comma-separated free-text input with a chip-list. Each
 * existing token renders as a chip (with delete) and a green-check badge
 * when it's auto-recoverable at runtime. An inline "Add condition" panel
 * lets the author pick a known type from a Combobox; for parameterized
 * prefixes the panel exposes a per-prefix helper.
 *
 * For power users a "View raw" toggle reveals the original
 * comma-separated `<Input>`, with the user's preferred default
 * persisted in `localStorage` so it sticks across sessions.
 *
 * Backwards compat: the underlying value is still the comma-separated
 * string `requirements: 'a, b, c'` — `onChange` emits the same shape so
 * existing form callsites swap in without other changes.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Button, Combobox, Field, Icon, Input, Tooltip, useStyles2, type ComboboxOption } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import {
  FIXED_REQUIREMENTS,
  PARAMETERIZED_REQUIREMENT_EXAMPLES,
  PARAMETERIZED_REQUIREMENT_PREFIXES,
  REQUIREMENT_DESCRIPTIONS,
  isValidRequirement,
} from '../../../types/requirements.types';
import { isAutoRecoverableRequirement } from '../../../recovery';
import { StorageKeys } from '../../../lib/storage-keys';
import { HELPER_BY_PREFIX } from './condition-helpers';

const RAW_MODE_PREFERENCE_KEY = StorageKeys.BLOCK_EDITOR_CONDITION_RAW_MODE;

export type ConditionFieldMode = 'requirements' | 'objectives' | 'conditions' | 'verify';

export interface ConditionChipsFieldProps {
  /** Comma-separated list of tokens. */
  value: string;
  /** Called with the new comma-separated string after add/remove. */
  onChange: (next: string) => void;
  /** What kind of field this is — used for placeholder text and labels. */
  mode: ConditionFieldMode;
  /** Optional `data-testid` prefix for the container. */
  testId?: string;
  /** When true, the "View raw" toggle is hidden (useful in narrow spaces). */
  hideRawToggle?: boolean;
}

interface PickerOption extends ComboboxOption<string> {
  /** Whether the option represents a parameterized prefix (needs an argument). */
  isPrefix: boolean;
}

const PICKER_OPTIONS: PickerOption[] = [
  ...FIXED_REQUIREMENTS.map(
    (token): PickerOption => ({
      value: token,
      label: token,
      description: REQUIREMENT_DESCRIPTIONS[token] ?? '',
      isPrefix: false,
    })
  ),
  ...PARAMETERIZED_REQUIREMENT_PREFIXES.map(
    (prefix): PickerOption => ({
      value: prefix,
      label: prefix,
      description: REQUIREMENT_DESCRIPTIONS[prefix] ?? '',
      isPrefix: true,
    })
  ),
];

function tokensFromString(value: string): string[] {
  return value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function tokensToString(tokens: string[]): string {
  return tokens.join(', ');
}

function readRawModePreference(): boolean {
  try {
    return window.localStorage.getItem(RAW_MODE_PREFERENCE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeRawModePreference(value: boolean): void {
  try {
    window.localStorage.setItem(RAW_MODE_PREFERENCE_KEY, String(value));
  } catch {
    // localStorage unavailable — preference falls back to default each session.
  }
}

function getPlaceholder(mode: ConditionFieldMode): string {
  switch (mode) {
    case 'requirements':
      return 'e.g., exists-reftarget, on-page:/dashboards';
    case 'objectives':
      return 'e.g., dashboard-exists, has-datasource:prometheus';
    case 'conditions':
      return 'e.g., has-datasource:prometheus, on-page:/connections';
    case 'verify':
      return 'e.g., on-page:/dashboards';
  }
}

export function ConditionChipsField({
  value,
  onChange,
  mode,
  testId,
  hideRawToggle = false,
}: ConditionChipsFieldProps) {
  const styles = useStyles2(getStyles);
  const tokens = useMemo(() => tokensFromString(value), [value]);
  const [isRawMode, setIsRawMode] = useState<boolean>(() => readRawModePreference());
  const [isAdding, setIsAdding] = useState(false);
  const [pickedOption, setPickedOption] = useState<PickerOption | null>(null);
  const [argValue, setArgValue] = useState('');
  // Per-prefix helpers may compute their own validity (e.g. semver for
  // `min-version:`); when they do, we trust them over our naive emptiness
  // check. Default `true` so prefixes without helpers stay enabled.
  const [helperValid, setHelperValid] = useState(true);

  const toggleRawMode = useCallback(() => {
    setIsRawMode((prev) => {
      const next = !prev;
      writeRawModePreference(next);
      return next;
    });
    setIsAdding(false);
  }, []);

  const removeChip = useCallback(
    (token: string) => {
      const next = tokens.filter((t) => t !== token);
      onChange(tokensToString(next));
    },
    [tokens, onChange]
  );

  const startAdd = useCallback(() => {
    setIsAdding(true);
    setPickedOption(null);
    setArgValue('');
    setHelperValid(true);
  }, []);

  const cancelAdd = useCallback(() => {
    setIsAdding(false);
    setPickedOption(null);
    setArgValue('');
    setHelperValid(true);
  }, []);

  const commitAdd = useCallback(() => {
    if (!pickedOption) {
      return;
    }
    const newToken = pickedOption.isPrefix ? `${pickedOption.value}${argValue.trim()}` : pickedOption.value;
    if (!newToken || tokens.includes(newToken)) {
      cancelAdd();
      return;
    }
    onChange(tokensToString([...tokens, newToken]));
    cancelAdd();
  }, [pickedOption, argValue, tokens, onChange, cancelAdd]);

  // Allow Enter inside the argument input to commit the add
  const onArgKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitAdd();
      }
    },
    [commitAdd]
  );

  // Raw-text mode: show the underlying input. The lint surfaced by
  // ConditionLintMessages still renders below this from the parent.
  if (isRawMode) {
    return (
      <div data-testid={testId}>
        <Input value={value} onChange={(e) => onChange(e.currentTarget.value)} placeholder={getPlaceholder(mode)} />
        {!hideRawToggle && (
          <div className={styles.rawToggleRow}>
            <Button size="sm" variant="secondary" fill="text" type="button" onClick={toggleRawMode} icon="apps">
              Use chip editor
            </Button>
          </div>
        )}
      </div>
    );
  }

  // The example in PARAMETERIZED_REQUIREMENT_EXAMPLES is the full token
  // (e.g. `has-role:editor`), but the value input only accepts the part
  // after the prefix. Strip the prefix so the placeholder doesn't
  // mislead authors into typing the prefix twice.
  const argPlaceholder = (() => {
    if (!pickedOption?.isPrefix) {
      return '';
    }
    const example = PARAMETERIZED_REQUIREMENT_EXAMPLES.find((ex) => ex.prefix === pickedOption.value)?.example;
    if (example && example.startsWith(pickedOption.value)) {
      return example.slice(pickedOption.value.length);
    }
    return 'value';
  })();
  const HelperForPrefix = pickedOption?.isPrefix ? HELPER_BY_PREFIX[pickedOption.value] : undefined;

  return (
    <div data-testid={testId}>
      <div className={styles.chipRow}>
        {tokens.length === 0 && <span className={styles.emptyHint}>{getPlaceholder(mode)}</span>}
        {tokens.map((token) => (
          <Chip key={token} token={token} onRemove={() => removeChip(token)} />
        ))}
        {!isAdding && (
          <Button size="sm" variant="secondary" fill="text" type="button" icon="plus" onClick={startAdd}>
            Add condition
          </Button>
        )}
        {!hideRawToggle && (
          <Button size="sm" variant="secondary" fill="text" type="button" onClick={toggleRawMode} icon="brackets-curly">
            View raw
          </Button>
        )}
      </div>

      {isAdding && (
        <div className={styles.addPanel} role="group" aria-label="Add condition">
          <Field label="Type" description="Pick a known requirement or parameterized prefix">
            <Combobox
              options={PICKER_OPTIONS}
              value={pickedOption?.value ?? ''}
              onChange={(option) => {
                if (!option) {
                  setPickedOption(null);
                  return;
                }
                const matched = PICKER_OPTIONS.find((o) => o.value === option.value) ?? null;
                setPickedOption(matched);
                setArgValue('');
              }}
              placeholder="Pick a type…"
              data-testid={testId ? `${testId}-add-type` : undefined}
            />
          </Field>
          {pickedOption?.isPrefix && (
            <Field
              label="Value"
              description={REQUIREMENT_DESCRIPTIONS[pickedOption.value] ?? 'Value for the chosen prefix'}
            >
              {HelperForPrefix ? (
                <HelperForPrefix
                  value={argValue}
                  onChange={setArgValue}
                  onSubmit={commitAdd}
                  onValidityChange={setHelperValid}
                  testId={testId ? `${testId}-add-arg` : undefined}
                />
              ) : (
                <Input
                  value={argValue}
                  onChange={(e) => setArgValue(e.currentTarget.value)}
                  onKeyDown={onArgKeyDown}
                  placeholder={argPlaceholder}
                  autoFocus
                  data-testid={testId ? `${testId}-add-arg` : undefined}
                />
              )}
            </Field>
          )}
          <div className={styles.addActions}>
            <Button size="sm" variant="secondary" type="button" onClick={cancelAdd}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              type="button"
              onClick={commitAdd}
              disabled={
                !pickedOption || (pickedOption.isPrefix && (!argValue.trim() || (HelperForPrefix && !helperValid)))
              }
            >
              Add
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

interface ChipProps {
  token: string;
  onRemove: () => void;
}

function Chip({ token, onRemove }: ChipProps) {
  const styles = useStyles2(getStyles);
  const isRecoverable = isAutoRecoverableRequirement(token);
  const isKnown = isValidRequirement(token);
  const tooltipBody = !isKnown
    ? `Unknown condition — open "View raw" to edit, or remove this chip.`
    : isRecoverable
      ? 'Auto-recoverable: Pathfinder can fix this at runtime if it fails'
      : (REQUIREMENT_DESCRIPTIONS[token] ?? REQUIREMENT_DESCRIPTIONS[token.split(':')[0] + ':'] ?? 'Custom condition');

  const chipClass = `${styles.chip} ${!isKnown ? styles.chipUnknown : isRecoverable ? styles.chipRecoverable : styles.chipKnown}`;

  return (
    <Tooltip content={tooltipBody} placement="top">
      <span className={chipClass}>
        {isRecoverable && <Icon name="check-circle" size="sm" className={styles.chipRecoverableIcon} aria-hidden />}
        {!isKnown && <Icon name="exclamation-triangle" size="sm" className={styles.chipUnknownIcon} aria-hidden />}
        <span className={styles.chipText}>{token}</span>
        <button type="button" aria-label={`Remove ${token}`} onClick={onRemove} className={styles.chipRemoveButton}>
          <Icon name="times" size="sm" />
        </button>
      </span>
    </Tooltip>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  chipRow: css({
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: theme.spacing(0.5),
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    backgroundColor: theme.colors.background.primary,
    minHeight: 36,
  }),
  emptyHint: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    padding: theme.spacing(0, 0.5),
  }),
  chip: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: theme.spacing(0.25, 0.5),
    borderRadius: theme.shape.radius.default,
    fontSize: theme.typography.bodySmall.fontSize,
    fontFamily: theme.typography.fontFamilyMonospace,
    border: `1px solid transparent`,
    lineHeight: 1.4,
  }),
  chipKnown: css({
    backgroundColor: theme.colors.background.secondary,
    color: theme.colors.text.primary,
    borderColor: theme.colors.border.weak,
  }),
  chipRecoverable: css({
    backgroundColor: theme.colors.success.transparent,
    color: theme.colors.text.primary,
    borderColor: theme.colors.success.border,
  }),
  chipUnknown: css({
    backgroundColor: theme.colors.warning.transparent,
    color: theme.colors.text.primary,
    borderColor: theme.colors.warning.border,
  }),
  chipRecoverableIcon: css({
    color: theme.colors.success.text,
    flexShrink: 0,
  }),
  chipUnknownIcon: css({
    color: theme.colors.warning.text,
    flexShrink: 0,
  }),
  chipText: css({
    whiteSpace: 'nowrap',
  }),
  chipRemoveButton: css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    padding: 0,
    margin: 0,
    color: theme.colors.text.secondary,
    cursor: 'pointer',
    borderRadius: theme.shape.radius.default,
    '&:hover': {
      color: theme.colors.text.primary,
      backgroundColor: theme.colors.action.hover,
    },
  }),
  addPanel: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    marginTop: theme.spacing(1),
    padding: theme.spacing(1),
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    backgroundColor: theme.colors.background.secondary,
  }),
  addActions: css({
    display: 'flex',
    gap: theme.spacing(1),
    justifyContent: 'flex-end',
  }),
  rawToggleRow: css({
    marginTop: theme.spacing(0.5),
  }),
});
