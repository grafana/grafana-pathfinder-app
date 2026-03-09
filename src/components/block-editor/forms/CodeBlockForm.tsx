/**
 * Code Block Form
 *
 * Form for creating/editing code blocks that insert code into Monaco editors.
 * Provides fields for the code, language, target selector, description,
 * requirements, and skippable settings.
 */

import React, { useState, useCallback } from 'react';
import { Button, Field, Input, TextArea, Checkbox, Combobox, useStyles2, type ComboboxOption } from '@grafana/ui';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { getBlockFormStyles } from '../block-editor.styles';
import { TypeSwitchDropdown } from './TypeSwitchDropdown';
import type { BlockFormProps, JsonBlock } from '../types';
import type { JsonCodeBlockBlock } from '../../../types/json-guide.types';

function isCodeBlockBlock(block: JsonBlock): block is JsonCodeBlockBlock {
  return block.type === 'code-block';
}

const LANGUAGE_OPTIONS = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'k6', label: 'k6' },
  { value: 'python', label: 'Python' },
  { value: 'bash', label: 'Bash' },
  { value: 'yaml', label: 'YAML' },
  { value: 'json', label: 'JSON' },
  { value: 'go', label: 'Go' },
  { value: 'alloy', label: 'Alloy' },
  { value: 'sql', label: 'SQL' },
  { value: 'graphql', label: 'GraphQL' },
  { value: 'promql', label: 'PromQL' },
];

const DEFAULT_REFTARGET = "div[data-testid='data-testid Code editor container']";

const getCodeBlockFormStyles = (theme: GrafanaTheme2) => ({
  codeTextarea: css({
    fontFamily: 'monospace',
    fontSize: '13px',
    lineHeight: '1.4',
  }),
});

export function CodeBlockForm({
  initialData,
  onSubmit,
  onCancel,
  isEditing = false,
  onSwitchBlockType,
  onPickerModeChange,
}: BlockFormProps) {
  const styles = useStyles2(getBlockFormStyles);
  const codeStyles = useStyles2(getCodeBlockFormStyles);

  const initial = initialData && isCodeBlockBlock(initialData) ? initialData : null;

  const [code, setCode] = useState(initial?.code ?? '');
  const [language, setLanguage] = useState(initial?.language ?? 'javascript');
  const [reftarget, setReftarget] = useState(initial?.reftarget ?? DEFAULT_REFTARGET);
  const [content, setContent] = useState(initial?.content ?? '');
  const [requirements, setRequirements] = useState(initial?.requirements?.join(', ') ?? '');
  const [skippable, setSkippable] = useState(initial?.skippable ?? false);
  const [hint, setHint] = useState(initial?.hint ?? '');

  // Start element picker - pass callback to receive selected element
  const startPicker = useCallback(() => {
    onPickerModeChange?.(true, (selector: string) => {
      setReftarget(selector);
    });
  }, [onPickerModeChange]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      const parsedRequirements = requirements
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean);

      const block: JsonCodeBlockBlock = {
        type: 'code-block',
        code: code.trim(),
        reftarget: reftarget.trim(),
        ...(language && { language }),
        ...(content.trim() && { content: content.trim() }),
        ...(parsedRequirements.length > 0 && { requirements: parsedRequirements }),
        ...(skippable && { skippable }),
        ...(hint.trim() && { hint: hint.trim() }),
      };

      onSubmit(block as JsonBlock);
    },
    [code, language, reftarget, content, requirements, skippable, hint, onSubmit]
  );

  const isValid = code.trim().length > 0 && reftarget.trim().length > 0;

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      {/* Code */}
      <Field label="Code" description="The code to display and insert into the editor" required>
        <TextArea
          value={code}
          onChange={(e) => setCode(e.currentTarget.value)}
          placeholder="// Paste your code here"
          rows={10}
          className={codeStyles.codeTextarea}
        />
      </Field>

      {/* Language */}
      <Field label="Language" description="Syntax highlighting language">
        <Combobox
          options={LANGUAGE_OPTIONS}
          value={language}
          onChange={(opt: ComboboxOption<string>) => setLanguage(opt.value)}
        />
      </Field>

      {/* Target Selector */}
      <Field label="Target selector" description="CSS selector for the Monaco editor container" required>
        <div className={styles.selectorField}>
          <Input
            value={reftarget}
            onChange={(e) => setReftarget(e.currentTarget.value)}
            placeholder={DEFAULT_REFTARGET}
            className={styles.selectorInput}
          />
          <Button
            variant="secondary"
            onClick={startPicker}
            type="button"
            icon="crosshair"
            tooltip="Click an element to capture its selector"
          >
            Pick element
          </Button>
        </div>
      </Field>

      {/* Content / description */}
      <Field label="Description" description="Optional markdown description shown above the code">
        <TextArea
          value={content}
          onChange={(e) => setContent(e.currentTarget.value)}
          placeholder="Add this import to configure secrets..."
          rows={3}
        />
      </Field>

      {/* Requirements */}
      <Field label="Requirements" description="Comma-separated requirement conditions">
        <Input
          value={requirements}
          onChange={(e) => setRequirements(e.currentTarget.value)}
          placeholder="exists-reftarget"
        />
      </Field>

      {/* Hint */}
      <Field label="Hint" description="Message shown when requirements are not met">
        <Input
          value={hint}
          onChange={(e) => setHint(e.currentTarget.value)}
          placeholder="Navigate to the code editor first"
        />
      </Field>

      {/* Skippable */}
      <Checkbox
        label="Skippable"
        description="Allow users to skip this step"
        value={skippable}
        onChange={(e) => setSkippable(e.currentTarget.checked)}
      />

      {/* Actions */}
      <div className={styles.footer}>
        {isEditing && onSwitchBlockType && (
          <div className={styles.footerLeft}>
            <TypeSwitchDropdown currentType="code-block" onSwitch={onSwitchBlockType} blockData={initialData} />
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
