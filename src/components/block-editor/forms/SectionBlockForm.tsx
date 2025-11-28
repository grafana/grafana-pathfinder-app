/**
 * Section Block Form
 *
 * Form for creating/editing section blocks with nested block editing.
 */

import React, { useState, useCallback } from 'react';
import { Button, Field, Input, Badge, useStyles2, Alert } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { getBlockFormStyles } from '../block-editor.styles';
import { COMMON_REQUIREMENTS } from '../../../constants/interactive-config';
import { BLOCK_TYPE_METADATA } from '../constants';
import type { BlockFormProps, JsonBlock, BlockType } from '../types';
import type { JsonSectionBlock } from '../../../types/json-guide.types';

/**
 * Type guard for section blocks
 */
function isSectionBlock(block: JsonBlock): block is JsonSectionBlock {
  return block.type === 'section';
}

const getNestedStyles = (theme: GrafanaTheme2) => ({
  nestedBlocksContainer: css({
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    padding: theme.spacing(1.5),
    backgroundColor: theme.colors.background.secondary,
    marginTop: theme.spacing(1),
  }),
  nestedBlocksList: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(1),
  }),
  nestedBlockItem: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    backgroundColor: theme.colors.background.primary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  nestedBlockContent: css({
    flex: 1,
    overflow: 'hidden',
  }),
  nestedBlockType: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  nestedBlockPreview: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),
  addBlockHint: css({
    textAlign: 'center',
    padding: theme.spacing(2),
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
});

/**
 * Get a simple preview of a block
 */
function getBlockPreview(block: JsonBlock): string {
  switch (block.type) {
    case 'markdown':
      return block.content.split('\n')[0].slice(0, 40);
    case 'html':
      return block.content
        .replace(/<[^>]+>/g, ' ')
        .trim()
        .slice(0, 40);
    case 'interactive':
      return `${block.action}: ${block.reftarget.slice(0, 30)}`;
    case 'multistep':
      return `${block.steps.length} steps`;
    case 'guided':
      return `${block.steps.length} guided steps`;
    default:
      return '';
  }
}

/**
 * Section block form component
 */
export function SectionBlockForm({ initialData, onSubmit, onCancel, isEditing = false }: BlockFormProps) {
  const styles = useStyles2(getBlockFormStyles);
  const nestedStyles = useStyles2(getNestedStyles);

  // Initialize from existing data or defaults
  const initial = initialData && isSectionBlock(initialData) ? initialData : null;
  const [sectionId, setSectionId] = useState(initial?.id ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [requirements, setRequirements] = useState(initial?.requirements?.join(', ') ?? '');
  const [objectives, setObjectives] = useState(initial?.objectives?.join(', ') ?? '');
  const [nestedBlocks, setNestedBlocks] = useState<JsonBlock[]>(initial?.blocks ?? []);

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

      const block: JsonSectionBlock = {
        type: 'section',
        blocks: nestedBlocks,
        ...(sectionId.trim() && { id: sectionId.trim() }),
        ...(title.trim() && { title: title.trim() }),
        ...(reqArray.length > 0 && { requirements: reqArray }),
        ...(objArray.length > 0 && { objectives: objArray }),
      };
      onSubmit(block);
    },
    [sectionId, title, requirements, objectives, nestedBlocks, onSubmit]
  );

  const handleRequirementClick = useCallback((req: string) => {
    setRequirements((prev) => {
      if (prev.includes(req)) {
        return prev;
      }
      return prev ? `${prev}, ${req}` : req;
    });
  }, []);

  // Auto-generate ID from title
  const handleTitleChange = useCallback(
    (value: string) => {
      setTitle(value);
      if (!sectionId || sectionId === initial?.id) {
        const generated = value
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .trim();
        if (generated) {
          setSectionId(`section-${generated}`);
        }
      }
    },
    [sectionId, initial?.id]
  );

  // Remove nested block
  const handleRemoveNestedBlock = useCallback((index: number) => {
    setNestedBlocks((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Move nested block up
  const handleMoveUp = useCallback((index: number) => {
    if (index > 0) {
      setNestedBlocks((prev) => {
        const newBlocks = [...prev];
        [newBlocks[index - 1], newBlocks[index]] = [newBlocks[index], newBlocks[index - 1]];
        return newBlocks;
      });
    }
  }, []);

  // Move nested block down
  const handleMoveDown = useCallback((index: number) => {
    setNestedBlocks((prev) => {
      if (index < prev.length - 1) {
        const newBlocks = [...prev];
        [newBlocks[index], newBlocks[index + 1]] = [newBlocks[index + 1], newBlocks[index]];
        return newBlocks;
      }
      return prev;
    });
  }, []);

  const isValid = nestedBlocks.length > 0 || title.trim().length > 0;

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <Alert title="Section Blocks" severity="info">
        Sections group related interactive steps together. Add blocks after creating the section by editing individual
        blocks within the main editor.
      </Alert>

      {/* Section Title */}
      <Field label="Section Title" description="Heading displayed above the section">
        <Input
          value={title}
          onChange={(e) => handleTitleChange(e.currentTarget.value)}
          placeholder="e.g., Configure Data Source"
          autoFocus
        />
      </Field>

      {/* Section ID */}
      <Field label="Section ID" description="Unique identifier (auto-generated from title)">
        <Input
          value={sectionId}
          onChange={(e) => setSectionId(e.currentTarget.value)}
          placeholder="e.g., section-configure-datasource"
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
      <Field label="Objectives" description="Objectives tracked for section completion (comma-separated)">
        <Input
          value={objectives}
          onChange={(e) => setObjectives(e.currentTarget.value)}
          placeholder="e.g., completed-setup, configured-datasource"
        />
      </Field>

      {/* Nested Blocks Preview */}
      <Field label="Nested Blocks">
        <div className={nestedStyles.nestedBlocksContainer}>
          {nestedBlocks.length > 0 ? (
            <div className={nestedStyles.nestedBlocksList}>
              {nestedBlocks.map((block, index) => {
                const meta = BLOCK_TYPE_METADATA[block.type as BlockType];
                return (
                  <div key={index} className={nestedStyles.nestedBlockItem}>
                    <div className={nestedStyles.nestedBlockContent}>
                      <div className={nestedStyles.nestedBlockType}>
                        <span>{meta?.icon ?? '📄'}</span>
                        <Badge text={meta?.name ?? block.type} color="blue" />
                      </div>
                      <div className={nestedStyles.nestedBlockPreview}>{getBlockPreview(block)}</div>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="angle-up"
                      onClick={() => handleMoveUp(index)}
                      disabled={index === 0}
                      tooltip="Move up"
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="angle-down"
                      onClick={() => handleMoveDown(index)}
                      disabled={index === nestedBlocks.length - 1}
                      tooltip="Move down"
                    />
                    <Button
                      variant="destructive"
                      size="sm"
                      icon="trash-alt"
                      onClick={() => handleRemoveNestedBlock(index)}
                      tooltip="Remove block"
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={nestedStyles.addBlockHint}>
              No blocks yet. Add blocks to this section after creating it.
            </div>
          )}
        </div>
      </Field>

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
SectionBlockForm.displayName = 'SectionBlockForm';
