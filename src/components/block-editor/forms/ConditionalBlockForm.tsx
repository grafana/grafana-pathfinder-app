/**
 * Conditional Block Form
 *
 * Form for creating/editing conditional blocks.
 * Nested blocks in the whenTrue/whenFalse branches are managed
 * via drag-and-drop in the main editor, not in this form.
 */

import React, { useState, useCallback, useRef } from 'react';
import { Button, Field, Input, TextArea, Badge, useStyles2, Alert } from '@grafana/ui';
import { getBlockFormStyles } from '../block-editor.styles';
import { COMMON_REQUIREMENTS } from '../../../constants/interactive-config';
import type { BlockFormProps, JsonBlock } from '../types';
import type { JsonConditionalBlock } from '../../../types/json-guide.types';

/**
 * Type guard for conditional blocks
 */
function isConditionalBlock(block: JsonBlock): block is JsonConditionalBlock {
  return block.type === 'conditional';
}

/**
 * Conditional block form component
 */
export function ConditionalBlockForm({ initialData, onSubmit, onCancel, isEditing = false }: BlockFormProps) {
  const styles = useStyles2(getBlockFormStyles);

  // Initialize from existing data or defaults
  const initial = initialData && isConditionalBlock(initialData) ? initialData : null;
  const [conditions, setConditions] = useState(initial?.conditions?.join(', ') ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');

  // Preserve nested blocks when editing (but don't display them in the form)
  const whenTrueBlocks = useRef<JsonBlock[]>(initial?.whenTrue ?? []);
  const whenFalseBlocks = useRef<JsonBlock[]>(initial?.whenFalse ?? []);

  // Build the conditional block from current form state
  const buildBlock = useCallback((): JsonConditionalBlock => {
    // Parse conditions
    const conditionsArray = conditions
      .split(',')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    return {
      type: 'conditional',
      conditions: conditionsArray,
      whenTrue: whenTrueBlocks.current,
      whenFalse: whenFalseBlocks.current,
      ...(description.trim() && { description: description.trim() }),
    };
  }, [conditions, description]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      onSubmit(buildBlock());
    },
    [buildBlock, onSubmit]
  );

  const handleConditionClick = useCallback((condition: string) => {
    setConditions((prev) => {
      if (prev.includes(condition)) {
        return prev;
      }
      return prev ? `${prev}, ${condition}` : condition;
    });
  }, []);

  // Parse conditions to check validity
  const conditionsArray = conditions
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  const isValid = conditionsArray.length > 0;

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <Alert title="Conditional blocks" severity="info">
        Conditional blocks show different content based on whether conditions pass or fail. Add blocks to each branch
        by dragging them into the &quot;When conditions pass&quot; or &quot;When conditions fail&quot; areas in the
        main editor.
      </Alert>

      {/* Conditions */}
      <Field
        label="Conditions"
        description="Conditions that determine which branch to show (comma-separated). All conditions must pass to show the 'true' branch."
        required
      >
        <TextArea
          value={conditions}
          onChange={(e) => setConditions(e.currentTarget.value)}
          placeholder="e.g., has-datasource:prometheus, on-page:/connections"
          rows={2}
          autoFocus
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
              onClick={() => handleConditionClick(req)}
            />
          ))}
        </div>
      </div>

      {/* Description (optional, for authors only) */}
      <Field label="Description" description="Optional note for authors (not shown to users)">
        <Input
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          placeholder="e.g., Check if user has Prometheus installed"
        />
      </Field>

      {/* Preview of conditions */}
      {conditionsArray.length > 0 && (
        <div className={styles.previewSection}>
          <span className={styles.previewLabel}>Conditions to evaluate:</span>
          <ul className={styles.previewList}>
            {conditionsArray.map((condition, idx) => (
              <li key={idx}>{condition}</li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.footer}>
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
ConditionalBlockForm.displayName = 'ConditionalBlockForm';

