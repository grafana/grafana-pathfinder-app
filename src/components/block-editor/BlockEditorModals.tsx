/**
 * BlockEditorModals Component
 *
 * Container for modal dialogs in the block editor:
 * - GuideMetadataForm
 * - ConfirmModal (new guide)
 * - ImportGuideModal
 * - GitHubPRModal
 * - BlockEditorTour
 *
 * Note: BlockFormModal remains in BlockEditor due to complex editing state dependencies.
 * Note: RecordModeOverlay remains in BlockEditor due to actionRecorder integration.
 */

import React from 'react';
import { ConfirmModal } from '@grafana/ui';
import { GuideMetadataForm } from './GuideMetadataForm';
import { ImportGuideModal } from './ImportGuideModal';
import { GitHubPRModal } from './GitHubPRModal';
import { BlockEditorTour } from './BlockEditorTour';
import type { JsonGuide } from './types';
import type { ModalName } from './hooks/useModalManager';

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

  /** Guide metadata handlers */
  onUpdateGuideMetadata: (metadata: Partial<JsonGuide>) => void;

  /** New guide handlers */
  onNewGuideConfirm: () => void;

  /** Import handlers */
  onImportGuide: (guide: JsonGuide) => void;
}

export function BlockEditorModals({
  isModalOpen,
  closeModal,
  guide,
  isDirty,
  hasBlocks,
  onUpdateGuideMetadata,
  onNewGuideConfirm,
  onImportGuide,
}: BlockEditorModalsProps) {
  return (
    <>
      <GuideMetadataForm
        isOpen={isModalOpen('metadata')}
        guide={guide}
        onUpdate={onUpdateGuideMetadata}
        onClose={() => closeModal('metadata')}
      />

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

      {isModalOpen('tour') && <BlockEditorTour onClose={() => closeModal('tour')} />}
    </>
  );
}

BlockEditorModals.displayName = 'BlockEditorModals';
