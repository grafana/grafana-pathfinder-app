/**
 * BlockEditorModals Component
 *
 * Container for modal dialogs in the block editor:
 * - ConfirmModal (new guide)
 * - ImportGuideModal
 * - GitHubPRModal
 * - GuideDetailsModal
 * - BlockEditorTour
 *
 * Note: BlockFormModal remains in BlockEditor due to complex editing state dependencies.
 * Note: RecordModeOverlay remains in BlockEditor due to actionRecorder integration.
 */

import React from 'react';
import { ConfirmModal } from '@grafana/ui';
import { ImportGuideModal } from './ImportGuideModal';
import { GitHubPRModal } from './GitHubPRModal';
import { GuideDetailsModal } from './GuideDetailsModal';
import { BlockEditorTour } from './BlockEditorTour';
import type { JsonGuide } from './types';
import type { ModalName } from './hooks/useModalManager';
import type { GuideDetails } from './utils/derive-manifest';

export interface BlockEditorModalsProps {
  /** Modal visibility state */
  isModalOpen: (name: ModalName) => boolean;
  /** Close modal callback */
  closeModal: (name: ModalName) => void;

  /** Guide state */
  guide: JsonGuide;
  /** Whether there are unsaved changes */
  isDirty: boolean;
  /** Whether there are any blocks */
  hasBlocks: boolean;

  /** New guide handlers */
  onNewGuideConfirm: () => void;

  /** Import handlers */
  onImportGuide: (guide: JsonGuide) => void;

  /** Guide details (author and team) */
  authorName: string;
  team: string;
  authorPlaceholder: string;
  onSaveGuideDetails: (changes: GuideDetails) => void;
}

export function BlockEditorModals({
  isModalOpen,
  closeModal,
  guide,
  isDirty,
  hasBlocks,
  onNewGuideConfirm,
  onImportGuide,
  authorName,
  team,
  authorPlaceholder,
  onSaveGuideDetails,
}: BlockEditorModalsProps) {
  return (
    <>
      <ConfirmModal
        isOpen={isModalOpen('newGuideConfirm')}
        title="Start new guide"
        body="Are you sure you want to start a new guide? Your current work will be deleted and cannot be recovered."
        confirmText="Start new"
        dismissText="Cancel"
        onConfirm={onNewGuideConfirm}
        onDismiss={() => closeModal('newGuideConfirm')}
      />

      <ImportGuideModal
        isOpen={isModalOpen('import')}
        onImport={onImportGuide}
        onClose={() => closeModal('import')}
        hasUnsavedChanges={isDirty || hasBlocks}
      />

      <GitHubPRModal isOpen={isModalOpen('githubPr')} guide={guide} onClose={() => closeModal('githubPr')} />

      <GuideDetailsModal
        isOpen={isModalOpen('guideDetails')}
        initialAuthorName={authorName}
        initialTeam={team}
        authorPlaceholder={authorPlaceholder}
        onSave={onSaveGuideDetails}
        onClose={() => closeModal('guideDetails')}
      />

      {isModalOpen('tour') && <BlockEditorTour onClose={() => closeModal('tour')} />}
    </>
  );
}

BlockEditorModals.displayName = 'BlockEditorModals';
