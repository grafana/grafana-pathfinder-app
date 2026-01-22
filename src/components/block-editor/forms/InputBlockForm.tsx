/**
 * Input Block Form
 *
 * Form for creating/editing input blocks that collect user responses.
 * Supports text and boolean input types with validation options.
 */

import React, { useState, useCallback } from 'react';
import { Button, Field, Input, TextArea, RadioButtonGroup, Checkbox, Badge, useStyles2, Alert } from '@grafana/ui';
import { getBlockFormStyles } from '../block-editor.styles';
import { COMMON_REQUIREMENTS } from '../../../constants/interactive-config';
import { TypeSwitchDropdown } from './TypeSwitchDropdown';
import type { BlockFormProps, JsonBlock } from '../types';
import type { JsonInputBlock } from '../../../types/json-guide.types';

/**
 * Type guard for input blocks
 */
function isInputBlock(block: JsonBlock): block is JsonInputBlock {
  return block.type === 'input';
}

/** Input type options */
const INPUT_TYPE_OPTIONS = [
  { label: 'Text', value: 'text' as const },
  { label: 'Checkbox', value: 'boolean' as const },
];

/**
 * Validate variable name format
 */
function isValidVariableName(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

/**
 * Input block form component
 */
export function InputBlockForm({
  initialData,
  onSubmit,
  onCancel,
  isEditing = false,
  onSwitchBlockType,
}: BlockFormProps) {
  const styles = useStyles2(getBlockFormStyles);

  // Initialize from existing data or defaults
  const initial = initialData && isInputBlock(initialData) ? initialData : null;

  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  const [inputType, setInputType] = useState<'text' | 'boolean'>(initial?.inputType ?? 'text');
  const [variableName, setVariableName] = useState(initial?.variableName ?? '');
  const [placeholder, setPlaceholder] = useState(initial?.placeholder ?? '');
  const [checkboxLabel, setCheckboxLabel] = useState(initial?.checkboxLabel ?? '');
  const [defaultValue, setDefaultValue] = useState<string | boolean>(initial?.defaultValue ?? '');
  const [required, setRequired] = useState(initial?.required ?? false);
  const [pattern, setPattern] = useState(initial?.pattern ?? '');
  const [validationMessage, setValidationMessage] = useState(initial?.validationMessage ?? '');
  const [requirements, setRequirements] = useState(initial?.requirements?.join(', ') ?? '');
  const [skippable, setSkippable] = useState(initial?.skippable ?? false);

  // Handle requirement quick-add
  const handleRequirementClick = useCallback((req: string) => {
    setRequirements((prev) => {
      if (prev.includes(req)) {
        return prev;
      }
      return prev ? `${prev}, ${req}` : req;
    });
  }, []);

  // Form submission
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      // Parse requirements
      const reqArray = requirements
        .split(',')
        .map((r) => r.trim())
        .filter((r) => r.length > 0);

      const block: JsonInputBlock = {
        type: 'input',
        prompt: prompt.trim(),
        inputType,
        variableName: variableName.trim(),
        ...(inputType === 'text' && placeholder.trim() && { placeholder: placeholder.trim() }),
        ...(inputType === 'boolean' && checkboxLabel.trim() && { checkboxLabel: checkboxLabel.trim() }),
        ...(inputType === 'text' &&
          typeof defaultValue === 'string' &&
          defaultValue.trim() && { defaultValue: defaultValue.trim() }),
        ...(inputType === 'boolean' && typeof defaultValue === 'boolean' && { defaultValue }),
        ...(required && { required }),
        ...(inputType === 'text' && pattern.trim() && { pattern: pattern.trim() }),
        ...(validationMessage.trim() && { validationMessage: validationMessage.trim() }),
        ...(reqArray.length > 0 && { requirements: reqArray }),
        ...(skippable && { skippable }),
      };

      onSubmit(block);
    },
    [
      prompt,
      inputType,
      variableName,
      placeholder,
      checkboxLabel,
      defaultValue,
      required,
      pattern,
      validationMessage,
      requirements,
      skippable,
      onSubmit,
    ]
  );

  // Validation
  const hasPrompt = prompt.trim().length > 0;
  const hasValidVariableName = variableName.trim().length > 0 && isValidVariableName(variableName.trim());
  const isValid = hasPrompt && hasValidVariableName;

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <Alert title="Input block" severity="info">
        Collect user responses that can be used as variables elsewhere in the guide. Use{' '}
        <code>{'{{variableName}}'}</code> in content or <code>var-variableName:value</code> in requirements.
      </Alert>

      {/* Prompt */}
      <Field label="Prompt" description="The question or instruction shown to the user (supports markdown)" required>
        <TextArea
          value={prompt}
          onChange={(e) => setPrompt(e.currentTarget.value)}
          rows={2}
          placeholder="e.g., What is the name of your Prometheus data source?"
        />
      </Field>

      {/* Input Type */}
      <Field label="Input type" description="Text for free-form input, checkbox for yes/no acceptance">
        <RadioButtonGroup options={INPUT_TYPE_OPTIONS} value={inputType} onChange={setInputType} />
      </Field>

      {/* Variable Name */}
      <Field
        label="Variable name"
        description="Identifier for referencing this response (letters, numbers, underscores)"
        required
        invalid={variableName.length > 0 && !isValidVariableName(variableName)}
        error={
          variableName.length > 0 && !isValidVariableName(variableName)
            ? 'Must start with letter/underscore, contain only letters, numbers, underscores'
            : undefined
        }
      >
        <Input
          value={variableName}
          onChange={(e) => setVariableName(e.currentTarget.value)}
          placeholder="e.g., prometheusDataSource"
        />
      </Field>

      {/* Text-specific fields */}
      {inputType === 'text' && (
        <>
          <Field label="Placeholder" description="Hint text shown in the empty input field">
            <Input
              value={placeholder}
              onChange={(e) => setPlaceholder(e.currentTarget.value)}
              placeholder="e.g., Enter data source name..."
            />
          </Field>

          <Field label="Default value" description="Pre-filled value (user can change it)">
            <Input
              value={typeof defaultValue === 'string' ? defaultValue : ''}
              onChange={(e) => setDefaultValue(e.currentTarget.value)}
              placeholder="e.g., prometheus"
            />
          </Field>

          <Field label="Validation pattern" description="Regex pattern for validating input (optional)">
            <Input
              value={pattern}
              onChange={(e) => setPattern(e.currentTarget.value)}
              placeholder="e.g., ^[a-z][a-z0-9-]*$"
            />
          </Field>

          {pattern && (
            <Field label="Validation message" description="Message shown when validation fails">
              <Input
                value={validationMessage}
                onChange={(e) => setValidationMessage(e.currentTarget.value)}
                placeholder="e.g., Name must be lowercase with hyphens only"
              />
            </Field>
          )}
        </>
      )}

      {/* Boolean-specific fields */}
      {inputType === 'boolean' && (
        <>
          <Field label="Checkbox label" description="Text shown next to the checkbox">
            <Input
              value={checkboxLabel}
              onChange={(e) => setCheckboxLabel(e.currentTarget.value)}
              placeholder="e.g., I accept the data usage policy"
            />
          </Field>

          <Field label="Default checked">
            <Checkbox
              className={styles.checkbox}
              label="Checkbox is checked by default"
              checked={defaultValue === true}
              onChange={(e) => setDefaultValue(e.currentTarget.checked)}
            />
          </Field>
        </>
      )}

      {/* Required */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Options</div>
        <Checkbox
          className={styles.checkbox}
          label="Required (user must provide a value to proceed)"
          checked={required}
          onChange={(e) => setRequired(e.currentTarget.checked)}
        />
        <Checkbox
          className={styles.checkbox}
          label="Skippable (user can skip this input)"
          checked={skippable}
          onChange={(e) => setSkippable(e.currentTarget.checked)}
        />
      </div>

      {/* Requirements */}
      <Field label="Requirements" description="Conditions that must be met before showing this input (comma-separated)">
        <Input
          value={requirements}
          onChange={(e) => setRequirements(e.currentTarget.value)}
          placeholder="e.g., on-page:/connections/datasources"
        />
      </Field>
      <div className={styles.requirementsContainer}>
        <span className={styles.requirementsLabel}>Quick add:</span>
        <div className={styles.requirementsChips}>
          {COMMON_REQUIREMENTS.slice(0, 6).map((req) => (
            <Badge
              key={req}
              text={req}
              color="blue"
              className={styles.requirementChip}
              onClick={() => handleRequirementClick(req)}
            />
          ))}
        </div>
      </div>

      {/* Usage preview */}
      {variableName.trim() && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Usage examples</div>
          <div className={styles.codePreview}>
            <div>
              In content: <code>{`{{${variableName.trim()}}}`}</code>
            </div>
            <div>
              As requirement: <code>{`var-${variableName.trim()}:*`}</code> (any value)
            </div>
            {inputType === 'boolean' && (
              <div>
                Boolean check: <code>{`var-${variableName.trim()}:true`}</code>
              </div>
            )}
          </div>
        </div>
      )}

      <div className={styles.footer}>
        {isEditing && onSwitchBlockType && (
          <div className={styles.footerLeft}>
            <TypeSwitchDropdown currentType="input" onSwitch={onSwitchBlockType} blockData={initialData} />
          </div>
        )}
        <Button variant="secondary" onClick={onCancel} type="button">
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={!isValid}>
          {isEditing ? 'Update block' : 'Add block'}
        </Button>
      </div>
    </form>
  );
}

// Add display name for debugging
InputBlockForm.displayName = 'InputBlockForm';
