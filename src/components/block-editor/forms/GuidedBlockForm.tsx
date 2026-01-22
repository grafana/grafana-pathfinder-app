/**
 * Guided Block Form
 *
 * Form for creating/editing guided blocks (user-performed action sequences).
 */

import React, { useState, useCallback } from 'react';
import { Button, Field, Input, TextArea, Checkbox, Badge, useStyles2, Alert } from '@grafana/ui';
import { getBlockFormStyles } from '../block-editor.styles';
import { COMMON_REQUIREMENTS } from '../../../constants/interactive-config';
import { StepEditor } from './StepEditor';
import { TypeSwitchDropdown } from './TypeSwitchDropdown';
import type { BlockFormProps, JsonBlock, JsonStep } from '../types';
import type { JsonGuidedBlock } from '../../../types/json-guide.types';

/**
 * Type guard for guided blocks
 */
function isGuidedBlock(block: JsonBlock): block is JsonGuidedBlock {
  return block.type === 'guided';
}

/**
 * Guided block form component
 */
export function GuidedBlockForm({
  initialData,
  onSubmit,
  onCancel,
  isEditing = false,
  onPickerModeChange,
  onRecordModeChange,
  onSplitToBlocks,
  onConvertType,
  onSwitchBlockType,
  onPrepareTypeSwitch,
}: BlockFormProps) {
  const styles = useStyles2(getBlockFormStyles);

  // Initialize from existing data or defaults
  const initial = initialData && isGuidedBlock(initialData) ? initialData : null;
  const [content, setContent] = useState(initial?.content ?? '');
  const [steps, setSteps] = useState<JsonStep[]>(initial?.steps ?? []);
  const [stepTimeout, setStepTimeout] = useState(initial?.stepTimeout?.toString() ?? '120000');
  const [requirements, setRequirements] = useState(initial?.requirements?.join(', ') ?? '');
  const [objectives, setObjectives] = useState(initial?.objectives?.join(', ') ?? '');
  const [skippable, setSkippable] = useState(initial?.skippable ?? false);
  const [completeEarly, setCompleteEarly] = useState(initial?.completeEarly ?? false);

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

      const block: JsonGuidedBlock = {
        type: 'guided',
        content: content.trim(),
        steps,
        ...(stepTimeout && parseInt(stepTimeout, 10) !== 120000 && { stepTimeout: parseInt(stepTimeout, 10) }),
        ...(reqArray.length > 0 && { requirements: reqArray }),
        ...(objArray.length > 0 && { objectives: objArray }),
        ...(skippable && { skippable }),
        ...(completeEarly && { completeEarly }),
      };
      onSubmit(block);
    },
    [content, steps, stepTimeout, requirements, objectives, skippable, completeEarly, onSubmit]
  );

  const handleRequirementClick = useCallback((req: string) => {
    setRequirements((prev) => {
      if (prev.includes(req)) {
        return prev;
      }
      return prev ? `${prev}, ${req}` : req;
    });
  }, []);

  const isValid = content.trim().length > 0 && steps.length > 0;

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <Alert title="Guided Block" severity="info">
        Guided blocks highlight elements and <strong>wait for the user</strong> to perform the action. The system
        detects when the user completes each step before moving to the next.
      </Alert>

      {/* Description */}
      <Field label="Description" description="Markdown description shown to the user" required>
        <TextArea
          value={content}
          onChange={(e) => setContent(e.currentTarget.value)}
          rows={3}
          placeholder="Follow along and click each highlighted element to complete this section."
          autoFocus
        />
      </Field>

      {/* Steps */}
      <Field
        label={`Steps (${steps.length})`}
        description="Elements the user will interact with (highlighted in sequence)"
        required
      >
        <StepEditor
          steps={steps}
          onChange={setSteps}
          showRecordMode={true}
          isGuided={true}
          onPickerModeChange={onPickerModeChange}
          onRecordModeChange={onRecordModeChange}
        />
      </Field>

      {/* Step Timeout */}
      <Field
        label="Step Timeout (ms)"
        description="How long to wait for user action before timing out (default: 30000)"
      >
        <Input
          type="number"
          value={stepTimeout}
          onChange={(e) => setStepTimeout(e.currentTarget.value)}
          placeholder="30000"
          min={1000}
          step={1000}
        />
      </Field>

      {/* Requirements */}
      <Field label="Requirements" description="Conditions for the entire guided block (comma-separated)">
        <Input
          value={requirements}
          onChange={(e) => setRequirements(e.currentTarget.value)}
          placeholder="e.g., navmenu-open, exists-reftarget"
        />
      </Field>
      <div className={styles.requirementsContainer}>
        <span className={styles.requirementsLabel}>Quick add:</span>
        <div className={styles.requirementsChips}>
          {COMMON_REQUIREMENTS.map((req) => (
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

      {/* Objectives */}
      <Field label="Objectives" description="Objectives tracked for completion (comma-separated)">
        <Input
          value={objectives}
          onChange={(e) => setObjectives(e.currentTarget.value)}
          placeholder="e.g., completed-tutorial, learned-navigation"
        />
      </Field>

      {/* Options */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Options</div>
        <Checkbox
          className={styles.checkbox}
          label="Skippable (can be skipped if requirements fail)"
          checked={skippable}
          onChange={(e) => setSkippable(e.currentTarget.checked)}
        />
        <Checkbox
          className={styles.checkbox}
          label="Complete early (mark complete when user performs action early)"
          description="Marks the block as done if user completes the action before being prompted"
          checked={completeEarly}
          onChange={(e) => setCompleteEarly(e.currentTarget.checked)}
        />
      </div>

      <div className={styles.footer}>
        {/* Conversion options - only when editing */}
        {isEditing && (onSplitToBlocks || onConvertType || onSwitchBlockType) && (
          <div className={styles.footerLeft}>
            {onSwitchBlockType && (
              <TypeSwitchDropdown
                currentType="guided"
                onSwitch={onSwitchBlockType}
                blockData={initialData}
                onPrepareTypeSwitch={onPrepareTypeSwitch}
              />
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
                onClick={() => onConvertType('multistep')}
                type="button"
                icon="exchange-alt"
                tooltip="Convert to multistep block (automated execution)"
              />
            )}
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
GuidedBlockForm.displayName = 'GuidedBlockForm';
