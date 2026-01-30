/**
 * Section Block Form
 *
 * Form for creating/editing section blocks.
 * Nested blocks are managed via drag-and-drop in the main editor.
 */

import React, { useState, useCallback, useRef } from 'react';
import { Button, Field, Input, Badge, useStyles2, Alert } from '@grafana/ui';
import { getBlockFormStyles } from '../block-editor.styles';
import { COMMON_REQUIREMENTS } from '../../../constants/interactive-config';
import { testIds } from '../../testIds';
import type { BlockFormProps, JsonBlock } from '../types';
import type { JsonSectionBlock } from '../../../types/json-guide.types';

/**
 * Type guard for section blocks
 */
function isSectionBlock(block: JsonBlock): block is JsonSectionBlock {
  return block.type === 'section';
}

/**
 * Generate a default unique section ID
 */
function generateDefaultSectionId(): string {
  const randomNum = Math.floor(10000 + Math.random() * 90000);
  return `guide-section-${randomNum}`;
}

/**
 * Generate a section ID from a title
 */
function generateIdFromTitle(title: string): string {
  const generated = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
  return generated ? `section-${generated}` : '';
}

/**
 * Section block form component
 */
export function SectionBlockForm({
  initialData,
  onSubmit,
  onCancel,
  isEditing = false,
  onSubmitAndRecord,
}: BlockFormProps) {
  const styles = useStyles2(getBlockFormStyles);

  // Initialize from existing data or defaults
  const initial = initialData && isSectionBlock(initialData) ? initialData : null;
  const [sectionId, setSectionId] = useState(initial?.id ?? generateDefaultSectionId());
  const [title, setTitle] = useState(initial?.title ?? '');
  const [requirements, setRequirements] = useState(initial?.requirements?.join(', ') ?? '');
  const [objectives, setObjectives] = useState(initial?.objectives?.join(', ') ?? '');

  // Preserve nested blocks when editing (but don't display them in the form)
  const nestedBlocks = useRef<JsonBlock[]>(initial?.blocks ?? []);

  // Build the section block from current form state
  const buildBlock = useCallback((): JsonSectionBlock => {
    // Parse requirements and objectives
    const reqArray = requirements
      .split(',')
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
    const objArray = objectives
      .split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0);

    return {
      type: 'section',
      blocks: nestedBlocks.current,
      ...(sectionId.trim() && { id: sectionId.trim() }),
      ...(title.trim() && { title: title.trim() }),
      ...(reqArray.length > 0 && { requirements: reqArray }),
      ...(objArray.length > 0 && { objectives: objArray }),
    };
  }, [sectionId, title, requirements, objectives]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      onSubmit(buildBlock());
    },
    [buildBlock, onSubmit]
  );

  const handleSubmitAndRecord = useCallback(() => {
    if (onSubmitAndRecord) {
      onSubmitAndRecord(buildBlock());
    }
  }, [buildBlock, onSubmitAndRecord]);

  const handleRequirementClick = useCallback((req: string) => {
    setRequirements((prev) => {
      if (prev.includes(req)) {
        return prev;
      }
      return prev ? `${prev}, ${req}` : req;
    });
  }, []);

  // Handle title change - just update title, don't auto-generate ID yet
  const handleTitleChange = useCallback((value: string) => {
    setTitle(value);
  }, []);

  // Auto-generate ID from title on blur, but only if ID field is empty
  const handleTitleBlur = useCallback(() => {
    if (!sectionId.trim() && title.trim()) {
      const generated = generateIdFromTitle(title);
      if (generated) {
        setSectionId(generated);
      }
    }
  }, [title, sectionId]);

  // Handle ID change
  const handleIdChange = useCallback((value: string) => {
    setSectionId(value);
  }, []);

  const isValid = title.trim().length > 0;

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <Alert title="Section Blocks" severity="info">
        Sections group related blocks together. Add blocks to this section by dragging them into it in the main editor.
      </Alert>

      {/* Section Title */}
      <Field label="Section Title" description="Heading displayed above the section" required>
        <Input
          value={title}
          onChange={(e) => handleTitleChange(e.currentTarget.value)}
          onBlur={handleTitleBlur}
          placeholder="e.g., Configure Data Source"
          autoFocus
          data-testid={testIds.blockEditor.sectionTitleInput}
        />
      </Field>

      {/* Section ID */}
      <Field label="Section ID" description="Unique identifier for this section">
        <Input
          value={sectionId}
          onChange={(e) => handleIdChange(e.currentTarget.value)}
          placeholder="e.g., section-configure-datasource"
          data-testid={testIds.blockEditor.sectionIdInput}
        />
      </Field>

      {/* Requirements */}
      <Field
        label="Requirements"
        description="Conditions that must be met before section is accessible (comma-separated)"
      >
        <Input
          value={requirements}
          onChange={(e) => setRequirements(e.currentTarget.value)}
          placeholder="e.g., is-admin, on-page:/settings"
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
      <Field label="Objectives" description="Objectives tracked for section completion (comma-separated)">
        <Input
          value={objectives}
          onChange={(e) => setObjectives(e.currentTarget.value)}
          placeholder="e.g., completed-setup, configured-datasource"
        />
      </Field>

      <div className={styles.footer}>
        <Button variant="secondary" onClick={onCancel} type="button">
          Cancel
        </Button>
        {!isEditing && onSubmitAndRecord && (
          <Button
            variant="primary"
            type="button"
            disabled={!isValid}
            icon="circle"
            onClick={handleSubmitAndRecord}
            data-testid={testIds.blockEditor.addAndRecordButton}
          >
            Add and start recording
          </Button>
        )}
        <Button variant="primary" type="submit" disabled={!isValid} data-testid={testIds.blockEditor.submitButton}>
          {isEditing ? 'Update block' : 'Add block'}
        </Button>
      </div>
    </form>
  );
}

// Add display name for debugging
SectionBlockForm.displayName = 'SectionBlockForm';
