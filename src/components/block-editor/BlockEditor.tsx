/**
 * Block Editor
 *
 * Main component for the block-based JSON guide editor.
 * Provides a visual interface for composing guides from different block types.
 * State persists to localStorage automatically and survives page refreshes.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Button, useStyles2, Badge, ButtonGroup, ConfirmModal } from '@grafana/ui';
import { useBlockEditor } from './hooks/useBlockEditor';
import { useBlockPersistence } from './hooks/useBlockPersistence';
import { getBlockEditorStyles } from './block-editor.styles';
import { GuideMetadataForm } from './GuideMetadataForm';
import { BlockPalette } from './BlockPalette';
import { BlockList } from './BlockList';
import { BlockPreview } from './BlockPreview';
import { BlockFormModal } from './BlockFormModal';
import { ImportGuideModal } from './ImportGuideModal';
import { RecordModeOverlay } from './RecordModeOverlay';
import { GitHubPRModal } from './GitHubPRModal';
import { BlockEditorTour } from './BlockEditorTour';
import { useActionRecorder } from '../../utils/devtools';
import { copyGuideForWebsite } from '../../utils/guide-website-exporter';
import blockEditorTutorial from '../../bundled-interactives/block-editor-tutorial.json';
import type { JsonGuide, BlockType, JsonBlock, EditorBlock } from './types';
import type { JsonInteractiveBlock, JsonMultistepBlock, JsonGuidedBlock, JsonStep } from '../../types/json-guide.types';

export interface BlockEditorProps {
  /** Initial guide to load */
  initialGuide?: JsonGuide;
  /** Called when guide changes */
  onChange?: (guide: JsonGuide) => void;
  /** Called when copy to clipboard is requested */
  onCopy?: (json: string) => void;
  /** Called when download is requested */
  onDownload?: (guide: JsonGuide) => void;
}

/**
 * Block-based JSON guide editor
 */
export function BlockEditor({ initialGuide, onChange, onCopy, onDownload }: BlockEditorProps) {
  const styles = useStyles2(getBlockEditorStyles);
  const editor = useBlockEditor({ initialGuide, onChange });
  const hasLoadedFromStorage = useRef(false);

  // Modal state - declared early so persistence can check if modal is open
  const [isMetadataOpen, setIsMetadataOpen] = useState(false);
  const [isBlockFormOpen, setIsBlockFormOpen] = useState(false);
  const [editingBlockType, setEditingBlockType] = useState<BlockType | null>(null);
  const [editingBlock, setEditingBlock] = useState<EditorBlock | null>(null);
  const [insertAtIndex, setInsertAtIndex] = useState<number | undefined>(undefined);
  const [isNewGuideConfirmOpen, setIsNewGuideConfirmOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isGitHubPRModalOpen, setIsGitHubPRModalOpen] = useState(false);
  const [isTourOpen, setIsTourOpen] = useState(false);
  // State for editing nested blocks
  const [editingNestedBlock, setEditingNestedBlock] = useState<{
    sectionId: string;
    nestedIndex: number;
    block: JsonBlock;
  } | null>(null);

  // State for editing conditional branch blocks
  const [editingConditionalBranchBlock, setEditingConditionalBranchBlock] = useState<{
    conditionalId: string;
    branch: 'whenTrue' | 'whenFalse';
    nestedIndex: number;
    block: JsonBlock;
  } | null>(null);

  // Section recording state
  const [recordingIntoSection, setRecordingIntoSection] = useState<string | null>(null);
  const [recordingStartUrl, setRecordingStartUrl] = useState<string | null>(null);
  const pendingSectionIdRef = useRef<string | null>(null);

  // Conditional branch recording state
  const [recordingIntoConditionalBranch, setRecordingIntoConditionalBranch] = useState<{
    conditionalId: string;
    branch: 'whenTrue' | 'whenFalse';
  } | null>(null);

  // Block selection mode state (for merging blocks)
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(new Set());

  // Action recorder for section recording
  const actionRecorder = useActionRecorder({
    excludeSelectors: [
      '[class*="debug"]',
      '.context-container',
      '[data-devtools-panel]',
      '[data-block-editor]',
      '[data-testid="block-editor"]',
      '[data-record-overlay]', // Stop recording button and overlay elements
    ],
    enableModalDetection: true,
  });

  // Memoized callback for persistence save - prevents unnecessary effect triggers
  const handlePersistenceSave = useCallback(() => {
    editor.markSaved();
  }, [editor]);

  // Persistence - auto-save and restore from localStorage
  // Auto-save is paused while block form modal is open to avoid saving on every keystroke
  const persistence = useBlockPersistence({
    guide: editor.getGuide(),
    autoSave: true,
    autoSavePaused: isBlockFormOpen,
    onLoad: (savedGuide) => {
      // Only load once on initial mount
      if (!hasLoadedFromStorage.current && !initialGuide) {
        hasLoadedFromStorage.current = true;
        editor.loadGuide(savedGuide);
        editor.markSaved(); // Don't mark as dirty after loading
      }
    },
    onSave: handlePersistenceSave,
  });

  // Load from localStorage on mount (if no initialGuide provided)
  useEffect(() => {
    if (!hasLoadedFromStorage.current && !initialGuide && persistence.hasSavedGuide()) {
      const saved = persistence.load();
      if (saved) {
        hasLoadedFromStorage.current = true;
        editor.loadGuide(saved);
        editor.markSaved();
      }
    }
  }, [initialGuide, persistence, editor]);

  // Handle block type selection from palette
  const handleBlockTypeSelect = useCallback((type: BlockType, index?: number) => {
    setEditingBlockType(type);
    setEditingBlock(null);
    setInsertAtIndex(index);
    setIsBlockFormOpen(true);
  }, []);

  // Handle block edit
  const handleBlockEdit = useCallback((block: EditorBlock) => {
    setEditingBlockType(block.block.type as BlockType);
    setEditingBlock(block);
    setInsertAtIndex(undefined);
    setIsBlockFormOpen(true);
  }, []);

  // Handle form cancel
  const handleBlockFormCancel = useCallback(() => {
    setIsBlockFormOpen(false);
    setEditingBlockType(null);
    setEditingBlock(null);
    setEditingNestedBlock(null);
    setEditingConditionalBranchBlock(null);
    setInsertAtIndex(undefined);
    // Clear any section context
    delete (window as unknown as { __blockEditorSectionContext?: { sectionId: string; index?: number } })
      .__blockEditorSectionContext;
    // Clear any conditional context
    delete (
      window as unknown as {
        __blockEditorConditionalContext?: { conditionalId: string; branch: 'whenTrue' | 'whenFalse'; index?: number };
      }
    ).__blockEditorConditionalContext;
  }, []);

  // Handle split multistep/guided into individual interactive blocks
  const handleSplitToBlocks = useCallback(() => {
    // Check if we're editing a root-level or nested block
    const blockData = editingNestedBlock?.block ?? editingBlock?.block;
    if (!blockData || (blockData.type !== 'multistep' && blockData.type !== 'guided')) {
      return;
    }

    const steps = (blockData as JsonMultistepBlock | JsonGuidedBlock).steps;
    if (!steps || steps.length === 0) {
      return;
    }

    // Convert steps to interactive blocks
    const interactiveBlocks: JsonInteractiveBlock[] = steps.map((step) => ({
      type: 'interactive',
      action: step.action,
      reftarget: step.reftarget,
      content: step.tooltip || step.description || `${step.action} on element`,
      ...(step.targetvalue && { targetvalue: step.targetvalue }),
    }));

    if (editingNestedBlock) {
      // Nested block - replace within section
      const { sectionId, nestedIndex } = editingNestedBlock;
      // Delete the original block, then add the new ones at the same position
      editor.deleteNestedBlock(sectionId, nestedIndex);
      // Add in reverse order so they end up in correct sequence
      interactiveBlocks.reverse().forEach((block) => {
        editor.addBlockToSection(block, sectionId, nestedIndex);
      });
    } else if (editingBlock) {
      // Root-level block - replace at same position
      const blockIndex = editor.state.blocks.findIndex((b) => b.id === editingBlock.id);
      if (blockIndex !== -1) {
        // Remove the original
        editor.removeBlock(editingBlock.id);
        // Add the new blocks at the same position
        interactiveBlocks.forEach((block, i) => {
          editor.addBlock(block, blockIndex + i);
        });
      }
    }

    // Close the modal
    handleBlockFormCancel();
  }, [editingBlock, editingNestedBlock, editor, handleBlockFormCancel]);

  // Handle convert between multistep and guided
  const handleConvertType = useCallback(
    (newType: 'multistep' | 'guided') => {
      const blockData = editingNestedBlock?.block ?? editingBlock?.block;
      if (!blockData || (blockData.type !== 'multistep' && blockData.type !== 'guided')) {
        return;
      }

      const currentBlock = blockData as JsonMultistepBlock | JsonGuidedBlock;
      let convertedBlock: JsonMultistepBlock | JsonGuidedBlock;

      if (newType === 'guided') {
        // Convert multistep to guided
        convertedBlock = {
          type: 'guided',
          content: currentBlock.content,
          steps: currentBlock.steps.map((step) => ({
            ...step,
            // Move tooltip to description for guided
            description: step.tooltip || step.description,
            tooltip: undefined,
          })),
          ...(currentBlock.requirements && { requirements: currentBlock.requirements }),
          ...(currentBlock.objectives && { objectives: currentBlock.objectives }),
          ...(currentBlock.skippable && { skippable: currentBlock.skippable }),
        };
      } else {
        // Convert guided to multistep
        convertedBlock = {
          type: 'multistep',
          content: currentBlock.content,
          steps: currentBlock.steps.map((step) => ({
            ...step,
            // Move description to tooltip for multistep
            tooltip: step.description || step.tooltip,
            description: undefined,
          })),
          ...(currentBlock.requirements && { requirements: currentBlock.requirements }),
          ...(currentBlock.objectives && { objectives: currentBlock.objectives }),
          ...(currentBlock.skippable && { skippable: currentBlock.skippable }),
        };
      }

      if (editingNestedBlock) {
        // Update nested block
        editor.updateNestedBlock(editingNestedBlock.sectionId, editingNestedBlock.nestedIndex, convertedBlock);
      } else if (editingBlock) {
        // Update root-level block
        editor.updateBlock(editingBlock.id, convertedBlock);
      }

      // Close the modal
      handleBlockFormCancel();
    },
    [editingBlock, editingNestedBlock, editor, handleBlockFormCancel]
  );

  // Website export state
  const [websiteCopied, setWebsiteCopied] = useState(false);

  // Handle copy to clipboard
  const handleCopy = useCallback(() => {
    const guide = editor.getGuide();
    const json = JSON.stringify(guide, null, 2);

    if (onCopy) {
      onCopy(json);
    } else {
      navigator.clipboard.writeText(json).then(() => {
        // Could add a toast notification here
        console.log('Copied to clipboard');
      });
    }
  }, [editor, onCopy]);

  // Handle copy for website (shortcode format)
  const handleCopyForWebsite = useCallback(async () => {
    const guide = editor.getGuide();
    const success = await copyGuideForWebsite(guide);
    if (success) {
      setWebsiteCopied(true);
      setTimeout(() => setWebsiteCopied(false), 2000);
    }
  }, [editor]);

  // Handle download
  const handleDownload = useCallback(() => {
    const guide = editor.getGuide();

    if (onDownload) {
      onDownload(guide);
    } else {
      const json = JSON.stringify(guide, null, 2);
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      // Open in new window/tab
      const newWindow = window.open(url, '_blank');

      // Revoke URL after window loads to free memory
      if (newWindow) {
        newWindow.onload = () => {
          URL.revokeObjectURL(url);
        };
      } else {
        // If popup was blocked, revoke immediately
        URL.revokeObjectURL(url);
      }
    }
  }, [editor, onDownload]);

  // Handle new guide (reset and clear storage)
  const handleNewGuide = useCallback(() => {
    persistence.clear(); // Clear localStorage
    editor.resetGuide(); // Reset editor state
    setIsNewGuideConfirmOpen(false);
  }, [editor, persistence]);

  // Handle import guide
  const handleImportGuide = useCallback(
    (guide: JsonGuide) => {
      editor.loadGuide(guide);
      setIsImportModalOpen(false);
    },
    [editor]
  );

  // Handle loading the example template guide
  const handleLoadTemplate = useCallback(() => {
    editor.loadGuide(blockEditorTutorial as JsonGuide);
  }, [editor]);

  // Handle nesting a block into a section
  const handleNestBlock = useCallback(
    (blockId: string, sectionId: string, insertIndex?: number) => {
      editor.nestBlockInSection(blockId, sectionId, insertIndex);
    },
    [editor]
  );

  // Handle unnesting a block from a section
  const handleUnnestBlock = useCallback(
    (nestedBlockId: string, sectionId: string) => {
      editor.unnestBlockFromSection(nestedBlockId, sectionId);
    },
    [editor]
  );

  // Handle inserting a block directly into a section
  const handleInsertBlockInSection = useCallback((type: BlockType, sectionId: string, index?: number) => {
    // Open the form modal for this block type, but target the section
    setEditingBlockType(type);
    setEditingBlock(null);
    // We'll need to handle section insertion differently
    // For now, store the section ID and handle in submit
    setInsertAtIndex(undefined);
    setIsBlockFormOpen(true);

    // Store section context for insertion
    (
      window as unknown as { __blockEditorSectionContext?: { sectionId: string; index?: number } }
    ).__blockEditorSectionContext = {
      sectionId,
      index,
    };
  }, []);

  // Handle editing a nested block
  const handleNestedBlockEdit = useCallback((sectionId: string, nestedIndex: number, block: JsonBlock) => {
    setEditingBlockType(block.type as BlockType);
    setEditingBlock(null);
    setEditingNestedBlock({ sectionId, nestedIndex, block });
    setInsertAtIndex(undefined);
    setIsBlockFormOpen(true);
  }, []);

  // Handle deleting a nested block
  const handleNestedBlockDelete = useCallback(
    (sectionId: string, nestedIndex: number) => {
      editor.deleteNestedBlock(sectionId, nestedIndex);
    },
    [editor]
  );

  // Handle duplicating a nested block
  const handleNestedBlockDuplicate = useCallback(
    (sectionId: string, nestedIndex: number) => {
      editor.duplicateNestedBlock(sectionId, nestedIndex);
    },
    [editor]
  );

  // Handle moving a nested block within its section
  const handleNestedBlockMove = useCallback(
    (sectionId: string, fromIndex: number, toIndex: number) => {
      editor.moveNestedBlock(sectionId, fromIndex, toIndex);
    },
    [editor]
  );

  // ============ Conditional branch handlers ============

  // Handle inserting a block into a conditional branch
  const handleInsertBlockInConditional = useCallback(
    (type: BlockType, conditionalId: string, branch: 'whenTrue' | 'whenFalse', index?: number) => {
      setEditingBlockType(type);
      setEditingBlock(null);
      setInsertAtIndex(undefined);
      setIsBlockFormOpen(true);

      // Store conditional context for insertion
      (
        window as unknown as {
          __blockEditorConditionalContext?: { conditionalId: string; branch: 'whenTrue' | 'whenFalse'; index?: number };
        }
      ).__blockEditorConditionalContext = {
        conditionalId,
        branch,
        index,
      };
    },
    []
  );

  // Handle editing a block within a conditional branch
  const handleConditionalBranchBlockEdit = useCallback(
    (conditionalId: string, branch: 'whenTrue' | 'whenFalse', nestedIndex: number, block: JsonBlock) => {
      setEditingBlockType(block.type as BlockType);
      setEditingBlock(null);
      setEditingConditionalBranchBlock({ conditionalId, branch, nestedIndex, block });
      setInsertAtIndex(undefined);
      setIsBlockFormOpen(true);
    },
    []
  );

  // Handle deleting a block from a conditional branch
  const handleConditionalBranchBlockDelete = useCallback(
    (conditionalId: string, branch: 'whenTrue' | 'whenFalse', nestedIndex: number) => {
      editor.deleteConditionalBranchBlock(conditionalId, branch, nestedIndex);
    },
    [editor]
  );

  // Handle duplicating a block within a conditional branch
  const handleConditionalBranchBlockDuplicate = useCallback(
    (conditionalId: string, branch: 'whenTrue' | 'whenFalse', nestedIndex: number) => {
      editor.duplicateConditionalBranchBlock(conditionalId, branch, nestedIndex);
    },
    [editor]
  );

  // Handle moving a block within a conditional branch
  const handleConditionalBranchBlockMove = useCallback(
    (conditionalId: string, branch: 'whenTrue' | 'whenFalse', fromIndex: number, toIndex: number) => {
      editor.moveConditionalBranchBlock(conditionalId, branch, fromIndex, toIndex);
    },
    [editor]
  );

  // Handle nesting a root block into a conditional branch
  const handleNestBlockInConditional = useCallback(
    (blockId: string, conditionalId: string, branch: 'whenTrue' | 'whenFalse', insertIndex?: number) => {
      editor.nestBlockInConditional(blockId, conditionalId, branch, insertIndex);
    },
    [editor]
  );

  // Handle unnesting a block from a conditional branch
  const handleUnnestBlockFromConditional = useCallback(
    (conditionalId: string, branch: 'whenTrue' | 'whenFalse', nestedIndex: number, insertAtRootIndex?: number) => {
      editor.unnestBlockFromConditional(conditionalId, branch, nestedIndex, insertAtRootIndex);
    },
    [editor]
  );

  // Handle moving a block between conditional branches
  const handleMoveBlockBetweenConditionalBranches = useCallback(
    (
      conditionalId: string,
      fromBranch: 'whenTrue' | 'whenFalse',
      fromIndex: number,
      toBranch: 'whenTrue' | 'whenFalse',
      toIndex?: number
    ) => {
      editor.moveBlockBetweenConditionalBranches(conditionalId, fromBranch, fromIndex, toBranch, toIndex);
    },
    [editor]
  );

  // Handle section recording toggle
  const handleSectionRecord = useCallback(
    (sectionId: string) => {
      if (recordingIntoSection === sectionId) {
        // Stop recording - convert recorded steps to blocks and add to section
        actionRecorder.stopRecording();
        const steps = actionRecorder.recordedSteps;

        // Group consecutive steps with the same groupId into multisteps
        const processedSteps: Array<
          { type: 'single'; step: (typeof steps)[0] } | { type: 'group'; steps: typeof steps }
        > = [];

        let currentGroup: typeof steps = [];
        let currentGroupId: string | undefined;

        steps.forEach((step) => {
          if (step.groupId) {
            if (step.groupId === currentGroupId) {
              // Continue current group
              currentGroup.push(step);
            } else {
              // End previous group if exists
              if (currentGroup.length > 0) {
                processedSteps.push({ type: 'group', steps: currentGroup });
              }
              // Start new group
              currentGroupId = step.groupId;
              currentGroup = [step];
            }
          } else {
            // End current group if exists
            if (currentGroup.length > 0) {
              processedSteps.push({ type: 'group', steps: currentGroup });
              currentGroup = [];
              currentGroupId = undefined;
            }
            // Add single step
            processedSteps.push({ type: 'single', step });
          }
        });

        // Don't forget the last group
        if (currentGroup.length > 0) {
          processedSteps.push({ type: 'group', steps: currentGroup });
        }

        // Convert to blocks and add to section
        processedSteps.forEach((item) => {
          if (item.type === 'single') {
            // Single interactive block
            const interactiveBlock: JsonInteractiveBlock = {
              type: 'interactive',
              action: item.step.action as JsonInteractiveBlock['action'],
              reftarget: item.step.selector,
              content: item.step.description || `${item.step.action} on element`,
              ...(item.step.value && { targetvalue: item.step.value }),
            };
            editor.addBlockToSection(interactiveBlock, sectionId);
          } else {
            // Group of steps - create multistep block
            const multistepSteps: JsonStep[] = item.steps.map((step) => ({
              action: step.action as JsonStep['action'],
              reftarget: step.selector,
              ...(step.value && { targetvalue: step.value }),
              tooltip: step.description || `${step.action} on element`,
            }));

            const multistepBlock: JsonMultistepBlock = {
              type: 'multistep',
              content: item.steps[0].description || 'Complete the following steps',
              steps: multistepSteps,
            };
            editor.addBlockToSection(multistepBlock, sectionId);
          }
        });

        actionRecorder.clearRecording();
        setRecordingIntoSection(null);
        setRecordingStartUrl(null);
      } else {
        // Start recording into this section (clear any conditional recording first)
        setRecordingIntoConditionalBranch(null);
        actionRecorder.clearRecording();
        actionRecorder.startRecording();
        setRecordingIntoSection(sectionId);
        setRecordingStartUrl(window.location.href);
      }
    },
    [recordingIntoSection, actionRecorder, editor]
  );

  // Handle conditional branch recording toggle
  const handleConditionalBranchRecord = useCallback(
    (conditionalId: string, branch: 'whenTrue' | 'whenFalse') => {
      const isRecording =
        recordingIntoConditionalBranch?.conditionalId === conditionalId &&
        recordingIntoConditionalBranch?.branch === branch;

      if (isRecording) {
        // Stop recording - convert recorded steps to blocks and add to conditional branch
        actionRecorder.stopRecording();
        const steps = actionRecorder.recordedSteps;

        // Group consecutive steps with the same groupId into multisteps
        const processedSteps: Array<
          { type: 'single'; step: (typeof steps)[0] } | { type: 'group'; steps: typeof steps }
        > = [];

        let currentGroup: typeof steps = [];
        let currentGroupId: string | undefined;

        steps.forEach((step) => {
          if (step.groupId) {
            if (step.groupId === currentGroupId) {
              currentGroup.push(step);
            } else {
              if (currentGroup.length > 0) {
                processedSteps.push({ type: 'group', steps: currentGroup });
              }
              currentGroupId = step.groupId;
              currentGroup = [step];
            }
          } else {
            if (currentGroup.length > 0) {
              processedSteps.push({ type: 'group', steps: currentGroup });
              currentGroup = [];
              currentGroupId = undefined;
            }
            processedSteps.push({ type: 'single', step });
          }
        });

        if (currentGroup.length > 0) {
          processedSteps.push({ type: 'group', steps: currentGroup });
        }

        // Convert to blocks and add to conditional branch
        processedSteps.forEach((item) => {
          if (item.type === 'single') {
            const interactiveBlock: JsonInteractiveBlock = {
              type: 'interactive',
              action: item.step.action as JsonInteractiveBlock['action'],
              reftarget: item.step.selector,
              content: item.step.description || `${item.step.action} on element`,
              ...(item.step.value && { targetvalue: item.step.value }),
            };
            editor.addBlockToConditionalBranch(conditionalId, branch, interactiveBlock);
          } else {
            const multistepSteps: JsonStep[] = item.steps.map((step) => ({
              action: step.action as JsonStep['action'],
              reftarget: step.selector,
              ...(step.value && { targetvalue: step.value }),
              tooltip: step.description || `${step.action} on element`,
            }));

            const multistepBlock: JsonMultistepBlock = {
              type: 'multistep',
              content: item.steps[0].description || 'Complete the following steps',
              steps: multistepSteps,
            };
            editor.addBlockToConditionalBranch(conditionalId, branch, multistepBlock);
          }
        });

        actionRecorder.clearRecording();
        setRecordingIntoConditionalBranch(null);
        setRecordingStartUrl(null);
      } else {
        // Start recording into this conditional branch (clear any section recording first)
        setRecordingIntoSection(null);
        actionRecorder.clearRecording();
        actionRecorder.startRecording();
        setRecordingIntoConditionalBranch({ conditionalId, branch });
        setRecordingStartUrl(window.location.href);
      }
    },
    [recordingIntoConditionalBranch, actionRecorder, editor]
  );

  // Handle stop recording from overlay
  const handleStopRecording = useCallback(() => {
    if (recordingIntoSection) {
      handleSectionRecord(recordingIntoSection);
    } else if (recordingIntoConditionalBranch) {
      handleConditionalBranchRecord(
        recordingIntoConditionalBranch.conditionalId,
        recordingIntoConditionalBranch.branch
      );
    }
  }, [recordingIntoSection, handleSectionRecord, recordingIntoConditionalBranch, handleConditionalBranchRecord]);

  // Handle "Add and Start Recording" for new sections
  const handleSubmitAndStartRecording = useCallback(
    (block: JsonBlock) => {
      // Add the section block - returns the EditorBlock ID (UUID)
      const editorBlockId = editor.addBlock(block, insertAtIndex);
      setIsBlockFormOpen(false);
      setEditingBlockType(null);
      setEditingBlock(null);
      setInsertAtIndex(undefined);

      // Start recording into this section after a brief delay to allow UI to update
      pendingSectionIdRef.current = editorBlockId;
      const capturedUrl = window.location.href;
      setTimeout(() => {
        if (pendingSectionIdRef.current) {
          setRecordingIntoConditionalBranch(null); // Clear any conditional recording
          actionRecorder.clearRecording();
          actionRecorder.startRecording();
          setRecordingIntoSection(pendingSectionIdRef.current);
          setRecordingStartUrl(capturedUrl);
          pendingSectionIdRef.current = null;
        }
      }, 100);
    },
    [editor, insertAtIndex, actionRecorder]
  );

  // Selection mode handlers
  const handleToggleSelectionMode = useCallback(() => {
    setIsSelectionMode((prev) => {
      if (prev) {
        // Exiting selection mode - clear selection
        setSelectedBlockIds(new Set());
      }
      return !prev;
    });
  }, []);

  const handleToggleBlockSelection = useCallback((blockId: string) => {
    setSelectedBlockIds((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) {
        next.delete(blockId);
      } else {
        next.add(blockId);
      }
      return next;
    });
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedBlockIds(new Set());
    setIsSelectionMode(false);
  }, []);

  const handleMergeToMultistep = useCallback(() => {
    if (selectedBlockIds.size < 2) {
      return;
    }
    editor.mergeBlocksToMultistep(Array.from(selectedBlockIds));
    setSelectedBlockIds(new Set());
    setIsSelectionMode(false);
  }, [selectedBlockIds, editor]);

  const handleMergeToGuided = useCallback(() => {
    if (selectedBlockIds.size < 2) {
      return;
    }
    editor.mergeBlocksToGuided(Array.from(selectedBlockIds));
    setSelectedBlockIds(new Set());
    setIsSelectionMode(false);
  }, [selectedBlockIds, editor]);

  // Modified form submit to handle section insertions, nested block edits, and conditional branch blocks
  const handleBlockFormSubmitWithSection = useCallback(
    (block: JsonBlock) => {
      const sectionContext = (
        window as unknown as { __blockEditorSectionContext?: { sectionId: string; index?: number } }
      ).__blockEditorSectionContext;

      const conditionalContext = (
        window as unknown as {
          __blockEditorConditionalContext?: { conditionalId: string; branch: 'whenTrue' | 'whenFalse'; index?: number };
        }
      ).__blockEditorConditionalContext;

      if (editingConditionalBranchBlock) {
        // Editing a block within a conditional branch
        editor.updateConditionalBranchBlock(
          editingConditionalBranchBlock.conditionalId,
          editingConditionalBranchBlock.branch,
          editingConditionalBranchBlock.nestedIndex,
          block
        );
        setEditingConditionalBranchBlock(null);
      } else if (editingNestedBlock) {
        // Editing a nested block in a section
        editor.updateNestedBlock(editingNestedBlock.sectionId, editingNestedBlock.nestedIndex, block);
        setEditingNestedBlock(null);
      } else if (editingBlock) {
        editor.updateBlock(editingBlock.id, block);
      } else if (conditionalContext) {
        // Adding block to a conditional branch
        editor.addBlockToConditionalBranch(
          conditionalContext.conditionalId,
          conditionalContext.branch,
          block,
          conditionalContext.index
        );
        delete (
          window as unknown as {
            __blockEditorConditionalContext?: {
              conditionalId: string;
              branch: 'whenTrue' | 'whenFalse';
              index?: number;
            };
          }
        ).__blockEditorConditionalContext;
      } else if (sectionContext) {
        editor.addBlockToSection(block, sectionContext.sectionId, sectionContext.index);
        delete (window as unknown as { __blockEditorSectionContext?: { sectionId: string; index?: number } })
          .__blockEditorSectionContext;
      } else {
        editor.addBlock(block, insertAtIndex);
      }
      setIsBlockFormOpen(false);
      setEditingBlockType(null);
      setEditingBlock(null);
      setInsertAtIndex(undefined);
    },
    [editor, editingBlock, editingNestedBlock, editingConditionalBranchBlock, insertAtIndex]
  );

  const { state } = editor;
  const hasBlocks = state.blocks.length > 0;

  return (
    <div className={styles.container} data-testid="block-editor">
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h3 className={styles.guideTitle}>{state.guide.title}</h3>
          {state.isDirty ? (
            <Badge text="Auto-saving..." color="orange" icon="fa fa-spinner" />
          ) : (
            <Badge text="Saved" color="green" icon="check" />
          )}
          <Button
            variant="secondary"
            size="sm"
            icon="cog"
            onClick={() => setIsMetadataOpen(true)}
            tooltip="Edit guide settings"
            data-testid="guide-metadata-button"
          />
        </div>

        <div className={styles.headerRight}>
          {/* Tour button */}
          <Button
            variant="secondary"
            size="sm"
            icon="question-circle"
            onClick={() => setIsTourOpen(true)}
            tooltip="Take a tour of the guide editor"
          >
            Tour
          </Button>

          {/* View mode toggle - icon only */}
          <div className={styles.viewModeToggle} data-testid="view-mode-toggle">
            <ButtonGroup>
              <Button
                variant={!state.isPreviewMode ? 'primary' : 'secondary'}
                size="sm"
                icon="pen"
                onClick={() => editor.setPreviewMode(false)}
                tooltip="Edit mode"
              />
              <Button
                variant={state.isPreviewMode ? 'primary' : 'secondary'}
                size="sm"
                icon="eye"
                onClick={() => editor.setPreviewMode(true)}
                tooltip="Preview mode"
              />
            </ButtonGroup>
          </div>

          {/* Import button */}
          <Button
            variant="secondary"
            size="sm"
            icon="upload"
            onClick={() => setIsImportModalOpen(true)}
            tooltip="Import JSON guide"
          />

          {/* Export actions */}
          <Button
            variant="secondary"
            size="sm"
            icon="copy"
            onClick={handleCopy}
            tooltip="Copy JSON to clipboard"
            data-testid="copy-json-button"
          />
          <Button
            variant={websiteCopied ? 'success' : 'secondary'}
            size="sm"
            icon={websiteCopied ? 'check' : 'document-info'}
            onClick={handleCopyForWebsite}
            tooltip="Copy as website shortcodes"
          />
          <Button
            variant="secondary"
            size="sm"
            icon="download-alt"
            onClick={handleDownload}
            tooltip="Download JSON file"
          />
          <Button
            variant="secondary"
            size="sm"
            icon="github"
            onClick={() => setIsGitHubPRModalOpen(true)}
            tooltip="Create GitHub PR"
          />
          <Button
            variant="secondary"
            size="sm"
            icon="file-blank"
            onClick={() => setIsNewGuideConfirmOpen(true)}
            tooltip="Start new guide"
          />
        </div>
      </div>

      {/* Content */}
      <div className={styles.content} data-testid="block-editor-content">
        {/* Selection controls - shown in edit mode, above blocks */}
        {!state.isPreviewMode && hasBlocks && (
          <div className={styles.selectionControls}>
            {isSelectionMode && selectedBlockIds.size >= 2 ? (
              <>
                <span className={styles.selectionCount}>{selectedBlockIds.size} blocks selected</span>
                <Button variant="primary" size="sm" onClick={handleMergeToMultistep}>
                  Create multistep
                </Button>
                <Button variant="primary" size="sm" onClick={handleMergeToGuided}>
                  Create guided
                </Button>
                <Button variant="secondary" size="sm" onClick={handleClearSelection}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                variant={isSelectionMode ? 'primary' : 'secondary'}
                size="sm"
                icon="check-square"
                onClick={handleToggleSelectionMode}
                tooltip={
                  isSelectionMode ? 'Click to exit selection mode' : 'Select blocks to merge into multistep/guided'
                }
              >
                {isSelectionMode ? 'Done selecting' : 'Select blocks'}
              </Button>
            )}
          </div>
        )}

        {state.isPreviewMode ? (
          <BlockPreview guide={editor.getGuide()} />
        ) : hasBlocks ? (
          <BlockList
            blocks={state.blocks}
            onBlockEdit={handleBlockEdit}
            onBlockDelete={editor.removeBlock}
            onBlockMove={editor.moveBlock}
            onBlockDuplicate={editor.duplicateBlock}
            onInsertBlock={handleBlockTypeSelect}
            onNestBlock={handleNestBlock}
            onUnnestBlock={handleUnnestBlock}
            onInsertBlockInSection={handleInsertBlockInSection}
            onNestedBlockEdit={handleNestedBlockEdit}
            onNestedBlockDelete={handleNestedBlockDelete}
            onNestedBlockDuplicate={handleNestedBlockDuplicate}
            onNestedBlockMove={handleNestedBlockMove}
            onSectionRecord={handleSectionRecord}
            recordingIntoSection={recordingIntoSection}
            onConditionalBranchRecord={handleConditionalBranchRecord}
            recordingIntoConditionalBranch={recordingIntoConditionalBranch}
            isSelectionMode={isSelectionMode}
            selectedBlockIds={selectedBlockIds}
            onToggleBlockSelection={handleToggleBlockSelection}
            onInsertBlockInConditional={handleInsertBlockInConditional}
            onConditionalBranchBlockEdit={handleConditionalBranchBlockEdit}
            onConditionalBranchBlockDelete={handleConditionalBranchBlockDelete}
            onConditionalBranchBlockDuplicate={handleConditionalBranchBlockDuplicate}
            onConditionalBranchBlockMove={handleConditionalBranchBlockMove}
            onNestBlockInConditional={handleNestBlockInConditional}
            onUnnestBlockFromConditional={handleUnnestBlockFromConditional}
            onMoveBlockBetweenConditionalBranches={handleMoveBlockBetweenConditionalBranches}
          />
        ) : (
          <div className={styles.emptyState}>
            <div className={styles.emptyStateIcon}>📄</div>
            <p className={styles.emptyStateText}>Your guide is empty. Add your first block to get started.</p>
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <Button variant="secondary" onClick={handleLoadTemplate} icon="file-alt">
                Load example guide
              </Button>
              <Button variant="secondary" onClick={() => setIsTourOpen(true)} icon="question-circle">
                Take a tour
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Footer with add block button (only in edit mode) */}
      {!state.isPreviewMode && (
        <div className={styles.footer} data-testid="block-palette">
          <BlockPalette onSelect={handleBlockTypeSelect} embedded />
        </div>
      )}

      {/* Modals */}
      <GuideMetadataForm
        isOpen={isMetadataOpen}
        guide={state.guide}
        onUpdate={editor.updateGuideMetadata}
        onClose={() => setIsMetadataOpen(false)}
      />

      {isBlockFormOpen && editingBlockType && (
        <BlockFormModal
          blockType={editingBlockType}
          initialData={editingConditionalBranchBlock?.block ?? editingNestedBlock?.block ?? editingBlock?.block}
          onSubmit={handleBlockFormSubmitWithSection}
          onSubmitAndRecord={editingBlockType === 'section' ? handleSubmitAndStartRecording : undefined}
          onCancel={handleBlockFormCancel}
          isEditing={!!editingBlock || !!editingNestedBlock || !!editingConditionalBranchBlock}
          onSplitToBlocks={
            (editingBlockType === 'multistep' || editingBlockType === 'guided') &&
            (editingBlock || editingNestedBlock || editingConditionalBranchBlock)
              ? handleSplitToBlocks
              : undefined
          }
          onConvertType={
            (editingBlockType === 'multistep' || editingBlockType === 'guided') &&
            (editingBlock || editingNestedBlock || editingConditionalBranchBlock)
              ? handleConvertType
              : undefined
          }
        />
      )}

      <ConfirmModal
        isOpen={isNewGuideConfirmOpen}
        title="Start New Guide"
        body="Are you sure you want to start a new guide? Your current work will be deleted and cannot be recovered."
        confirmText="Start New"
        dismissText="Cancel"
        onConfirm={handleNewGuide}
        onDismiss={() => setIsNewGuideConfirmOpen(false)}
      />

      <ImportGuideModal
        isOpen={isImportModalOpen}
        onImport={handleImportGuide}
        onClose={() => setIsImportModalOpen(false)}
        hasUnsavedChanges={state.isDirty || state.blocks.length > 0}
      />

      <GitHubPRModal
        isOpen={isGitHubPRModalOpen}
        guide={editor.getGuide()}
        onClose={() => setIsGitHubPRModalOpen(false)}
      />

      {/* Record mode overlay for section/conditional recording */}
      {(recordingIntoSection || recordingIntoConditionalBranch) && (
        <RecordModeOverlay
          isRecording={actionRecorder.isRecording}
          stepCount={actionRecorder.recordedSteps.length}
          onStop={handleStopRecording}
          sectionName={
            recordingIntoSection
              ? state.blocks.find((b) => b.id === recordingIntoSection)?.block.type === 'section'
                ? ((state.blocks.find((b) => b.id === recordingIntoSection)?.block as { title?: string }).title ??
                  'Section')
                : 'Section'
              : `Conditional branch (${recordingIntoConditionalBranch?.branch === 'whenTrue' ? 'pass' : 'fail'})`
          }
          startingUrl={recordingStartUrl ?? undefined}
        />
      )}

      {/* Block Editor Tour */}
      {isTourOpen && <BlockEditorTour onClose={() => setIsTourOpen(false)} />}
    </div>
  );
}

// Add display name for debugging
BlockEditor.displayName = 'BlockEditor';
