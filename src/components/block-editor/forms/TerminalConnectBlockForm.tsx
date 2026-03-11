/**
 * Terminal Connect Block Form
 *
 * Form for creating/editing terminal connect blocks.
 * These blocks render a "Try in terminal" button that opens
 * and connects to the Coda terminal.
 */

import React, { useState, useCallback } from 'react';
import { Button, Field, Input, TextArea, useStyles2 } from '@grafana/ui';
import { getBlockFormStyles } from '../block-editor.styles';
import { TypeSwitchDropdown } from './TypeSwitchDropdown';
import type { BlockFormProps, JsonBlock } from '../types';
import type { JsonTerminalConnectBlock } from '../../../types/json-guide.types';

function isTerminalConnectBlock(block: JsonBlock): block is JsonTerminalConnectBlock {
  return block.type === 'terminal-connect';
}

export function TerminalConnectBlockForm({
  initialData,
  onSubmit,
  onCancel,
  isEditing = false,
  onSwitchBlockType,
}: BlockFormProps) {
  const styles = useStyles2(getBlockFormStyles);

  const initial = initialData && isTerminalConnectBlock(initialData) ? initialData : null;

  const [content, setContent] = useState(initial?.content ?? '');
  const [buttonText, setButtonText] = useState(initial?.buttonText ?? '');

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      const block: JsonTerminalConnectBlock = {
        type: 'terminal-connect',
        content: content.trim(),
        ...(buttonText.trim() && { buttonText: buttonText.trim() }),
      };

      onSubmit(block as JsonBlock);
    },
    [content, buttonText, onSubmit]
  );

  const isValid = content.trim().length > 0;

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      {/* Content / description */}
      <Field label="Description" description="Markdown description shown above the connect button" required>
        <TextArea
          value={content}
          onChange={(e) => setContent(e.currentTarget.value)}
          placeholder="Click the button below to connect to a terminal session where you can run commands..."
          rows={3}
        />
      </Field>

      {/* Custom button text */}
      <Field label="Button text" description="Custom button label (defaults to 'Try in terminal')">
        <Input
          value={buttonText}
          onChange={(e) => setButtonText(e.currentTarget.value)}
          placeholder="Try in terminal"
        />
      </Field>

      {/* Actions */}
      <div className={styles.footer}>
        {isEditing && onSwitchBlockType && (
          <div className={styles.footerLeft}>
            <TypeSwitchDropdown currentType="terminal-connect" onSwitch={onSwitchBlockType} blockData={initialData} />
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
