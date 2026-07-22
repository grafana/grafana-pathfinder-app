/**
 * Collapsible Block Form
 *
 * Form for creating/editing collapsible blocks. The nested content is edited
 * inline via BranchBlocksEditor, so a collapsible is fully authored in one
 * place without the main editor's section drag-and-drop.
 */

import React, { useState, useCallback } from 'react';
import { Button, Field, Input, Switch, useStyles2 } from '@grafana/ui';
import { getBlockFormStyles } from '../block-editor.styles';
import { BranchBlocksEditor } from './BranchBlocksEditor';
import { testIds } from '../../../constants/testIds';
import type { BlockFormProps, JsonBlock } from '../types';
import type { JsonCollapsibleBlock, NonContainerBlock } from '../../../types/json-guide.types';

function isCollapsibleBlock(block: JsonBlock): block is JsonCollapsibleBlock {
  return block.type === 'collapsible';
}

export function CollapsibleBlockForm({
  initialData,
  onSubmit,
  onCancel,
  isEditing = false,
  onPickerModeChange,
}: BlockFormProps) {
  const styles = useStyles2(getBlockFormStyles);

  const initial = initialData && isCollapsibleBlock(initialData) ? initialData : null;
  const initialId = initial?.id;
  const [title, setTitle] = useState(initial?.title ?? '');
  const [collapsed, setCollapsed] = useState(initial?.collapsed ?? true);
  const [blocks, setBlocks] = useState<JsonBlock[]>(initial?.blocks ?? []);

  const buildBlock = useCallback((): JsonCollapsibleBlock => {
    return {
      type: 'collapsible',
      // BranchBlocksEditor's add menu (ALLOWED_BRANCH_BLOCK_TYPES) excludes all
      // container types, so the edited list only ever holds non-container blocks.
      blocks: blocks as NonContainerBlock[],
      ...(title.trim() && { title: title.trim() }),
      // Persist only when it differs from the `true` default.
      ...(collapsed === false && { collapsed: false }),
      ...(initialId && { id: initialId }),
    };
  }, [title, collapsed, blocks, initialId]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      onSubmit(buildBlock());
    },
    [buildBlock, onSubmit]
  );

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <Field label="Toggle label" description="Text shown on the control that reveals the content">
        <Input
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          placeholder="e.g., Show solution"
          autoFocus
          data-testid={testIds.blockEditor.collapsibleTitleInput}
        />
      </Field>

      <Field
        label="Start collapsed"
        description="When enabled, the content is hidden until the learner clicks the toggle"
      >
        <Switch
          value={collapsed}
          onChange={(e) => setCollapsed(e.currentTarget.checked)}
          data-testid={testIds.blockEditor.collapsibleCollapsedToggle}
        />
      </Field>

      <BranchBlocksEditor
        label="Hidden content"
        variant="success"
        blocks={blocks}
        onChange={setBlocks}
        onPickerModeChange={onPickerModeChange}
      />

      <div className={styles.footer}>
        <Button variant="secondary" onClick={onCancel} type="button">
          Cancel
        </Button>
        <Button variant="primary" type="submit" data-testid={testIds.blockEditor.submitButton}>
          {isEditing ? 'Update block' : 'Add block'}
        </Button>
      </div>
    </form>
  );
}

CollapsibleBlockForm.displayName = 'CollapsibleBlockForm';
