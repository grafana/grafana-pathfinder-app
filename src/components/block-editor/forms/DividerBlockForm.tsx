import React, { useCallback } from 'react';
import { Button, useStyles2 } from '@grafana/ui';

import type { JsonDividerBlock } from '../../../types/json-guide.types';
import { testIds } from '../../../constants/testIds';
import { getBlockFormStyles } from '../block-editor.styles';
import type { BlockFormProps } from '../types';
import { TypeSwitchDropdown } from './TypeSwitchDropdown';

export function DividerBlockForm({
  initialData,
  onSubmit,
  onCancel,
  isEditing = false,
  onSwitchBlockType,
}: BlockFormProps) {
  const styles = useStyles2(getBlockFormStyles);

  const handleSubmit = useCallback(
    (event: React.SubmitEvent) => {
      event.preventDefault();
      const existing = initialData?.type === 'divider' ? initialData : undefined;
      const block: JsonDividerBlock = {
        type: 'divider',
        ...(existing?.id && { id: existing.id }),
        ...(existing?.authorNote && { authorNote: existing.authorNote }),
      };
      onSubmit(block);
    },
    [initialData, onSubmit]
  );

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <p>A divider has no editable content. It renders a horizontal separator with standard guide spacing.</p>
      <div className={styles.footer}>
        {isEditing && onSwitchBlockType && (
          <div className={styles.footerLeft}>
            <TypeSwitchDropdown currentType="divider" onSwitch={onSwitchBlockType} blockData={initialData} />
          </div>
        )}
        <Button variant="secondary" onClick={onCancel} type="button" data-testid={testIds.blockEditor.formCancelButton}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" data-testid={testIds.blockEditor.submitButton}>
          {isEditing ? 'Update block' : 'Add block'}
        </Button>
      </div>
    </form>
  );
}

DividerBlockForm.displayName = 'DividerBlockForm';
