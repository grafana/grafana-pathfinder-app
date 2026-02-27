/**
 * Terminal Block Form
 *
 * Form for creating/editing terminal command blocks.
 * Provides fields for the shell command, description content,
 * requirements, and skippable settings.
 */

import React, { useState, useCallback } from 'react';
import { Button, Field, Input, TextArea, Checkbox, useStyles2 } from '@grafana/ui';
import { getBlockFormStyles } from '../block-editor.styles';
import { TypeSwitchDropdown } from './TypeSwitchDropdown';
import type { BlockFormProps, JsonBlock } from '../types';
import type { JsonTerminalBlock } from '../../../types/json-guide.types';

function isTerminalBlock(block: JsonBlock): block is JsonTerminalBlock {
  return block.type === 'terminal';
}

export function TerminalBlockForm({
  initialData,
  onSubmit,
  onCancel,
  isEditing = false,
  onSwitchBlockType,
}: BlockFormProps) {
  const styles = useStyles2(getBlockFormStyles);

  const initial = initialData && isTerminalBlock(initialData) ? initialData : null;

  const [command, setCommand] = useState(initial?.command ?? '');
  const [content, setContent] = useState(initial?.content ?? '');
  const [requirements, setRequirements] = useState(initial?.requirements?.join(', ') ?? '');
  const [skippable, setSkippable] = useState(initial?.skippable ?? false);
  const [hint, setHint] = useState(initial?.hint ?? '');

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      const parsedRequirements = requirements
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean);

      const block: JsonTerminalBlock = {
        type: 'terminal',
        command: command.trim(),
        content: content.trim(),
        ...(parsedRequirements.length > 0 && { requirements: parsedRequirements }),
        ...(skippable && { skippable }),
        ...(hint.trim() && { hint: hint.trim() }),
      };

      onSubmit(block as JsonBlock);
    },
    [command, content, requirements, skippable, hint, onSubmit]
  );

  const isValid = command.trim().length > 0 && content.trim().length > 0;

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      {/* Command */}
      <Field label="Command" description="Shell command to display and execute" required>
        <TextArea
          value={command}
          onChange={(e) => setCommand(e.currentTarget.value)}
          placeholder="echo 'Hello from Pathfinder'"
          rows={2}
        />
      </Field>

      {/* Content / description */}
      <Field label="Description" description="Markdown description shown above the command" required>
        <TextArea
          value={content}
          onChange={(e) => setContent(e.currentTarget.value)}
          placeholder="Run this command to verify your setup..."
          rows={3}
        />
      </Field>

      {/* Requirements */}
      <Field label="Requirements" description="Comma-separated requirement conditions">
        <Input
          value={requirements}
          onChange={(e) => setRequirements(e.currentTarget.value)}
          placeholder="is-terminal-active"
        />
      </Field>

      {/* Hint */}
      <Field label="Hint" description="Message shown when requirements are not met">
        <Input
          value={hint}
          onChange={(e) => setHint(e.currentTarget.value)}
          placeholder="Connect to a terminal first"
        />
      </Field>

      {/* Skippable */}
      <Checkbox
        label="Skippable"
        description="Allow users to skip this step"
        value={skippable}
        onChange={(e) => setSkippable(e.currentTarget.checked)}
      />

      {/* Actions */}
      <div className={styles.footer}>
        {isEditing && onSwitchBlockType && (
          <div className={styles.footerLeft}>
            <TypeSwitchDropdown currentType="terminal" onSwitch={onSwitchBlockType} blockData={initialData} />
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
