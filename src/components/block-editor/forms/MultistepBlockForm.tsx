/**
 * Multistep Block Form
 *
 * Form for creating/editing multistep blocks (automated action sequences).
 */

import React, { useState, useCallback } from 'react';
import { Button, Field, Input, TextArea, Checkbox, Badge, useStyles2, Alert } from '@grafana/ui';
import { getBlockFormStyles } from '../block-editor.styles';
import { COMMON_REQUIREMENTS } from '../../../constants/interactive-config';
import { StepEditor } from './StepEditor';
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
        <StepEditor steps={steps} onChange={setSteps} showRecordMode={true} onPickerModeChange={onPickerModeChange} />
      </Field>

      {/* Requirements */}
      <Field label="Requirements" description="Conditions for the entire multistep block (comma-separated)">
        <Input
          value={requirements}
          onChange={(e) => setRequirements(e.currentTarget.value)}
          placeholder="e.g., navmenu-open, exists-reftarget"
        />
      </Field>
      <div className={styles.requirementsContainer}>
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

      {/* Objectives */}
      <Field label="Objectives" description="Objectives tracked for completion (comma-separated)">
        <Input
          value={objectives}
          onChange={(e) => setObjectives(e.currentTarget.value)}
          placeholder="e.g., opened-menu, selected-option"
        />
      </Field>

      {/* Skippable */}
      <Checkbox
        label="Skippable (can be skipped if requirements fail)"
        checked={skippable}
        onChange={(e) => setSkippable(e.currentTarget.checked)}
      />

      <div className={styles.footer}>
        <Button variant="secondary" onClick={onCancel} type="button">
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={!isValid}>
          {isEditing ? 'Update Block' : 'Add Block'}
        </Button>
      </div>
    </form>
  );
}

// Add display name for debugging
MultistepBlockForm.displayName = 'MultistepBlockForm';
