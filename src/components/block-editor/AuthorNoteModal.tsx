/**
 * `AuthorNoteModal` — a tiny modal for editing the editor-only
 * `authorNote` field on any block.
 *
 * Shared across all block types (interactive, markdown, section, etc.)
 * because every block carries the same `authorNote?: string` field
 * post-Wave-2. Not part of the type-specific form modals — those stay
 * focused on the runtime-meaningful fields. Notes are a sidecar
 * concern: jot a TODO, leave a reminder, keep an authoring breadcrumb.
 *
 * Saving an empty string clears the note (and the indicator icon).
 * The published export pipeline strips the field via `stripAuthorNotes`.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Button, Modal, TextArea, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';

export interface AuthorNoteModalProps {
  isOpen: boolean;
  initialNote: string;
  onSave: (note: string) => void;
  onClose: () => void;
}

export function AuthorNoteModal({ isOpen, initialNote, onSave, onClose }: AuthorNoteModalProps) {
  const styles = useStyles2(getStyles);
  const [draft, setDraft] = useState(initialNote);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Reset the draft every time the modal opens so reopening on a
  // different block doesn't leak the previous block's note. The set
  // happens during the open transition only (tracked via `wasOpen`)
  // — React docs' "adjust state when prop changes" pattern, avoids
  // the cascading-render warning that effect-based resets trip.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    if (isOpen) {
      setDraft(initialNote);
    }
    setWasOpen(isOpen);
  }

  // Focus the textarea after render so authors can start typing
  // immediately. setTimeout(0) avoids a Grafana Modal mounting race.
  useEffect(() => {
    if (isOpen) {
      const id = window.setTimeout(() => textareaRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [isOpen]);

  const handleSave = () => {
    onSave(draft.trim());
    onClose();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <Modal title="Author note" isOpen={isOpen} onDismiss={onClose}>
      {/* Stop pointer / mouse / click / key bubbling. The Modal portals
          to document.body, but React event bubbling follows the React
          tree — without this, textarea events bubble up to the owning
          BlockItem's SortableBlock listeners. Key blocking is the
          critical one: dnd-kit's KeyboardSensor uses Space to activate
          a drag, so typing a space in the note input would otherwise
          arm a phantom drag (and the list would jump on every space). */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <p className={styles.help}>
          Author-only note attached to this block. Useful for TODOs, reminders, or context for collaborators. Not
          visible to readers and stripped from the published guide.
        </p>
        <TextArea
          ref={(el) => {
            textareaRef.current = el;
          }}
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          rows={5}
          placeholder="e.g. Revisit this selector after the dashboard refactor"
          data-testid="pathfinder-block-editor-author-note-textarea"
        />
        <Modal.ButtonRow>
          <Button variant="secondary" onClick={onClose} fill="outline">
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} data-testid="pathfinder-block-editor-author-note-save">
            Save note
          </Button>
        </Modal.ButtonRow>
      </div>
    </Modal>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  help: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    margin: theme.spacing(0, 0, 1.5, 0),
  }),
});
