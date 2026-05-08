/**
 * Multistep Block Form
 *
 * Form for creating/editing multistep blocks (automated action sequences).
 */

import React, { useState, useCallback } from 'react';
import { Button, Field, TextArea, Checkbox, useStyles2, Alert } from '@grafana/ui';
import { getBlockFormStyles } from '../block-editor.styles';
import { StepEditor } from './StepEditor';
import { TypeSwitchDropdown } from './TypeSwitchDropdown';
import { ConditionChipsField } from './ConditionChipsField';
import {
  useFieldLint,
  ConditionLintMessages,
  replaceTokenInConditionField,
  removeTokenFromConditionField,
} from '../lint';
import { testIds } from '../../../constants/testIds';
import type { BlockFormProps, JsonBlock, JsonStep } from '../types';
import type { JsonMultistepBlock } from '../../../types/json-guide.types';

/**
 * Type guard for multistep blocks
 */
function isMultistepBlock(block: JsonBlock): block is JsonMultistepBlock {
  return block.type === 'multistep';
}

/**
 * Multistep block form component
 */
export function MultistepBlockForm({
  initialData,
  onSubmit,
  onCancel,
  isEditing = false,
  onPickerModeChange,
  onRecordModeChange,
  onSplitToBlocks,
  onConvertType,
  onSwitchBlockType,
}: BlockFormProps) {
  const styles = useStyles2(getBlockFormStyles);

  // Initialize from existing data or defaults
  const initial = initialData && isMultistepBlock(initialData) ? initialData : null;
  const [content, setContent] = useState(initial?.content ?? '');
  const [steps, setSteps] = useState<JsonStep[]>(initial?.steps ?? []);
  const [requirements, setRequirements] = useState(initial?.requirements?.join(', ') ?? '');
  const [objectives, setObjectives] = useState(initial?.objectives?.join(', ') ?? '');
  const [skippable, setSkippable] = useState(initial?.skippable ?? false);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      // Parse requirements and objectives
      const reqArray = requirements
        .split(',')
        .map((r) => r.trim())
        .filter((r) => {
          return r.length > 0;
        });
      const objArray = objectives
        .split(',')
        .map((o) => o.trim())
        .filter((o) => {
          return o.length > 0;
        });

      const block: JsonMultistepBlock = {
        type: 'multistep',
        content: content.trim(),
        steps,
        ...(reqArray.length > 0 && { requirements: reqArray }),
        ...(objArray.length > 0 && { objectives: objArray }),
        ...(skippable && { skippable }),
      };
      onSubmit(block);
    },
    [content, steps, requirements, objectives, skippable, onSubmit]
  );

  const requirementsLint = useFieldLint(requirements);
  const objectivesLint = useFieldLint(objectives);
  const fixRequirementsToken = useCallback((bad: string, good: string) => {
    setRequirements((prev) => replaceTokenInConditionField(prev, bad, good));
  }, []);
  const fixObjectivesToken = useCallback((bad: string, good: string) => {
    setObjectives((prev) => replaceTokenInConditionField(prev, bad, good));
  }, []);
  const removeRequirementsToken = useCallback((bad: string) => {
    setRequirements((prev) => removeTokenFromConditionField(prev, bad));
  }, []);
  const removeObjectivesToken = useCallback((bad: string) => {
    setObjectives((prev) => removeTokenFromConditionField(prev, bad));
  }, []);

  const isValid = content.trim().length > 0 && steps.length > 0;

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <Alert title="Multistep Block" severity="info">
        Multistep blocks execute all steps <strong>automatically</strong> when the user clicks &quot;Do it&quot;. Use
        this for sequences like opening a dropdown and selecting an option.
      </Alert>

      {/* Description */}
      <Field label="Description" description="Markdown description shown to the user" required>
        <TextArea
          value={content}
          onChange={(e) => setContent(e.currentTarget.value)}
          rows={3}
          placeholder="This will **automatically** open the menu and select the option."
          autoFocus
        />
      </Field>

      {/* Steps */}
      <Field label={`Steps (${steps.length})`} description="Actions executed automatically in sequence" required>
        <StepEditor
          steps={steps}
          onChange={setSteps}
          showRecordMode={true}
          onPickerModeChange={onPickerModeChange}
          onRecordModeChange={onRecordModeChange}
        />
      </Field>

      {/* Requirements */}
      <Field label="Requirements" description="Conditions that must be met before this multistep runs">
        <ConditionChipsField
          value={requirements}
          onChange={setRequirements}
          mode="requirements"
          testId="multistep-block-requirements"
        />
      </Field>
      <ConditionLintMessages
        diagnostics={requirementsLint}
        onApplyFix={fixRequirementsToken}
        onRemoveToken={removeRequirementsToken}
        testId="multistep-block-requirements-lint"
      />

      {/* Objectives */}
      <Field
        label="Objectives"
        description="Post-conditions checked after the multistep. If they're already met when it starts, the multistep is skipped."
      >
        <ConditionChipsField
          value={objectives}
          onChange={setObjectives}
          mode="objectives"
          testId="multistep-block-objectives"
        />
      </Field>
      <ConditionLintMessages
        diagnostics={objectivesLint}
        onApplyFix={fixObjectivesToken}
        onRemoveToken={removeObjectivesToken}
        testId="multistep-block-objectives-lint"
      />

      {/* Skippable */}
      <Checkbox
        className={styles.checkbox}
        label="Skippable (can be skipped if requirements fail)"
        checked={skippable}
        onChange={(e) => setSkippable(e.currentTarget.checked)}
      />

      <div className={styles.footer}>
        {/* Conversion options - only when editing */}
        {isEditing && (onSplitToBlocks || onConvertType || onSwitchBlockType) && (
          <div className={styles.footerLeft}>
            {onSwitchBlockType && (
              <TypeSwitchDropdown currentType="multistep" onSwitch={onSwitchBlockType} blockData={initialData} />
            )}
            {onSplitToBlocks && steps.length > 0 && (
              <Button
                variant="secondary"
                onClick={onSplitToBlocks}
                type="button"
                icon="layers-alt"
                tooltip="Split into individual interactive blocks"
              />
            )}
            {onConvertType && (
              <Button
                variant="secondary"
                onClick={() => onConvertType('guided')}
                type="button"
                icon="exchange-alt"
                tooltip="Convert to guided block (user performs actions)"
              />
            )}
          </div>
        )}
        <Button variant="secondary" onClick={onCancel} type="button" data-testid={testIds.blockEditor.formCancelButton}>
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
MultistepBlockForm.displayName = 'MultistepBlockForm';
