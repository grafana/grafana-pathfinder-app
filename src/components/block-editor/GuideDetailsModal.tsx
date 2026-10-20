/**
 * `GuideDetailsModal` — edits the manifest author name and team of the guide being written.
 *
 * Values are held in editor memory and written at the next backend save, so opening this modal
 * never touches the stored guide. Leaving the name empty keeps whatever the save would otherwise
 * choose; a field is reported only when the author changed it.
 */

import React, { useState } from 'react';
import { Button, Field, Input, Modal } from '@grafana/ui';
import { testIds } from '../../constants/testIds';
import type { GuideDetails } from './utils/derive-manifest';

export interface GuideDetailsModalProps {
  isOpen: boolean;
  /** Author name already in effect for this guide, or empty when none is stored. */
  initialAuthorName: string;
  initialTeam: string;
  /** Shown when the name is empty: what a save will use. */
  authorPlaceholder: string;
  onSave: (changes: GuideDetails) => void;
  onClose: () => void;
}

export function GuideDetailsModal({
  isOpen,
  initialAuthorName,
  initialTeam,
  authorPlaceholder,
  onSave,
  onClose,
}: GuideDetailsModalProps) {
  const [authorName, setAuthorName] = useState(initialAuthorName);
  const [team, setTeam] = useState(initialTeam);

  // Reset on the open transition so reopening never shows a previous guide's values.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    if (isOpen) {
      setAuthorName(initialAuthorName);
      setTeam(initialTeam);
    }
    setWasOpen(isOpen);
  }

  const handleSave = () => {
    const nextName = authorName.trim();
    const nextTeam = team.trim();
    onSave({
      ...(nextName !== initialAuthorName && nextName !== '' ? { authorName: nextName } : {}),
      ...(nextTeam !== initialTeam ? { team: nextTeam } : {}),
    });
    onClose();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <Modal title="Guide details" isOpen={isOpen} onDismiss={onClose}>
      <Field label="Author" description="Who readers should ask about this guide.">
        <Input
          value={authorName}
          onChange={(e) => setAuthorName(e.currentTarget.value)}
          placeholder={authorPlaceholder}
          data-testid={testIds.blockEditor.guideDetailsAuthorInput}
        />
      </Field>
      <Field label="Team" description="Optional. The team that owns this guide.">
        <Input
          value={team}
          onChange={(e) => setTeam(e.currentTarget.value)}
          data-testid={testIds.blockEditor.guideDetailsTeamInput}
        />
      </Field>
      <Modal.ButtonRow>
        <Button variant="secondary" fill="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave} data-testid={testIds.blockEditor.guideDetailsSave}>
          Save details
        </Button>
      </Modal.ButtonRow>
    </Modal>
  );
}

GuideDetailsModal.displayName = 'GuideDetailsModal';
