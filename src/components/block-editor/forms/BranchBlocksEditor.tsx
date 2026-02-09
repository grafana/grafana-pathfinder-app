/**
 * Branch Blocks Editor
 *
 * Component for editing blocks within conditional branches (whenTrue/whenFalse).
 * Displays a list of blocks with drag-drop reordering, add/edit/delete functionality.
 * Similar to StepEditor but for full JsonBlock arrays.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { Button, Field, Input, Combobox, Badge, IconButton, TextArea, useStyles2, type ComboboxOption } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css, cx } from '@emotion/css';
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  MeasuringStrategy,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { BLOCK_TYPE_METADATA, BLOCK_TYPE_ORDER, INTERACTIVE_ACTIONS } from '../constants';
import { COMMON_REQUIREMENTS } from '../../../constants/interactive-config';
import type { BlockType, JsonBlock, JsonInteractiveAction, BlockFormProps } from '../types';
import {
  isMarkdownBlock,
  isInteractiveBlock,
  isImageBlock,
  isVideoBlock,
  isInputBlock,
} from '../../../types/json-guide.types';
import { getBlockPreview } from '../utils';

// ============================================================================
// Styles
// ============================================================================

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  }),
  header: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    cursor: 'pointer',
    userSelect: 'none',
    '&:hover': {
      backgroundColor: theme.colors.action.hover,
    },
  }),
  headerIcon: css({
    color: theme.colors.text.secondary,
    transition: 'transform 0.2s ease',
  }),
  headerIconExpanded: css({
    transform: 'rotate(90deg)',
  }),
  headerTitle: css({
    flex: 1,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  blocksList: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    maxHeight: '400px',
    overflowY: 'auto',
  }),
  blockItem: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    backgroundColor: theme.colors.background.primary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    cursor: 'grab',
    transition: 'all 0.15s ease',
    userSelect: 'none',
    touchAction: 'none',
    '&:hover': {
      borderColor: theme.colors.border.medium,
      boxShadow: theme.shadows.z1,
    },
    '&:active': {
      cursor: 'grabbing',
    },
  }),
  blockItemDragging: css({
    opacity: 0.4,
    cursor: 'grabbing',
  }),
  blockItemEditing: css({
    flexDirection: 'column',
    alignItems: 'stretch',
    cursor: 'default',
    '&:active': {
      cursor: 'default',
    },
  }),
  dragHandle: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    color: theme.colors.text.disabled,
    flexShrink: 0,
    pointerEvents: 'none',
  }),
  blockContent: css({
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
  }),
  blockHeader: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
  }),
  blockPreview: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),
  blockActions: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    flexShrink: 0,
  }),
  editButton: css({
    color: theme.colors.primary.text,
    backgroundColor: theme.colors.primary.transparent,
    borderRadius: theme.shape.radius.default,
    transition: 'all 0.15s ease',
    '&:hover': {
      backgroundColor: theme.colors.primary.shade,
      color: theme.colors.primary.contrastText,
    },
  }),
  deleteButton: css({
    opacity: 0.7,
    color: theme.colors.error.text,
    transition: 'all 0.15s ease',
    '&:hover': {
      opacity: 1,
      backgroundColor: theme.colors.error.transparent,
    },
  }),
  emptyState: css({
    textAlign: 'center',
    padding: theme.spacing(2),
    color: theme.colors.text.secondary,
    fontStyle: 'italic',
  }),
  addBlockSection: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  }),
  addBlockForm: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
    padding: theme.spacing(1.5),
    backgroundColor: theme.colors.background.canvas,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  formRow: css({
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'flex-end',
  }),
  formActions: css({
    display: 'flex',
    gap: theme.spacing(1),
    justifyContent: 'flex-end',
    marginTop: theme.spacing(1),
  }),
  editForm: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    backgroundColor: theme.colors.background.canvas,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.medium}`,
    marginTop: theme.spacing(1),
  }),
  quickAddChips: css({
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(0.5),
    marginTop: theme.spacing(0.5),
  }),
  requirementChip: css({
    cursor: 'pointer',
    '&:hover': {
      opacity: 0.8,
    },
  }),
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a default block of a given type
 */
function createDefaultBlock(type: BlockType): JsonBlock {
  switch (type) {
    case 'markdown':
      return { type: 'markdown', content: '' };
    case 'interactive':
      return { type: 'interactive', action: 'highlight', reftarget: '', content: '' };
    case 'image':
      return { type: 'image', src: '' };
    case 'video':
      return { type: 'video', src: '' };
    case 'quiz':
      return {
        type: 'quiz',
        question: '',
        choices: [
          { id: 'a', text: '', correct: true },
          { id: 'b', text: '' },
        ],
      };
    case 'input':
      return { type: 'input', prompt: '', inputType: 'text', variableName: '' };
    case 'multistep':
      return { type: 'multistep', content: '', steps: [] };
    case 'guided':
      return { type: 'guided', content: '', steps: [] };
    default:
      return { type: 'markdown', content: '' };
  }
}

// Block types allowed in conditional branches (no sections or conditionals)
const ALLOWED_BRANCH_BLOCK_TYPES: BlockType[] = BLOCK_TYPE_ORDER.filter((t) => t !== 'section' && t !== 'conditional');

// Block types that support inline form editing in BranchBlocksEditor
// quiz, multistep, and guided require the dedicated editors and cannot be edited inline
const INLINE_EDITABLE_TYPES: BlockType[] = ['markdown', 'interactive', 'image', 'video', 'input'];

const ACTION_OPTIONS: Array<ComboboxOption<JsonInteractiveAction>> = INTERACTIVE_ACTIONS.map((a) => ({
  value: a.value as JsonInteractiveAction,
  label: a.label,
}));

// ============================================================================
// Sortable Block Item
// ============================================================================

interface SortableBlockItemProps {
  id: string;
  index: number;
  children: React.ReactNode;
  disabled: boolean;
}

function SortableBlockItem({ id, index, children, disabled }: SortableBlockItemProps) {
  const styles = useStyles2(getStyles);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data: { type: 'branch-block', index },
    disabled,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cx(isDragging && styles.blockItemDragging)}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export interface BranchBlocksEditorProps {
  /** Label for the branch (e.g., "When conditions pass") */
  label: string;
  /** Color variant for the header */
  variant: 'success' | 'warning';
  /** Current blocks in this branch */
  blocks: JsonBlock[];
  /** Called when blocks change */
  onChange: (blocks: JsonBlock[]) => void;
  /** Called to start/stop the element picker */
  onPickerModeChange?: BlockFormProps['onPickerModeChange'];
}

export function BranchBlocksEditor({ label, variant, blocks, onChange, onPickerModeChange }: BranchBlocksEditorProps) {
  const styles = useStyles2(getStyles);

  // Expansion state
  const [isExpanded, setIsExpanded] = useState(true);

  // Add block form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newBlockType, setNewBlockType] = useState<BlockType>('markdown');

  // Edit block state
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  // Form fields for adding/editing
  const [formContent, setFormContent] = useState('');
  const [formAction, setFormAction] = useState<JsonInteractiveAction>('highlight');
  const [formReftarget, setFormReftarget] = useState('');
  const [formTargetvalue, setFormTargetvalue] = useState('');
  const [formRequirements, setFormRequirements] = useState('');
  const [formSrc, setFormSrc] = useState('');
  const [formAlt, setFormAlt] = useState('');
  const [formPrompt, setFormPrompt] = useState('');
  const [formVariableName, setFormVariableName] = useState('');

  // DnD sensors
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 8 },
  });
  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  });
  const sensors = useSensors(pointerSensor, keyboardSensor);

  // Block IDs for sortable context
  const blockIds = useMemo(() => blocks.map((_, i) => `branch-block-${i}`), [blocks]);

  // Reset form fields
  const resetFormFields = useCallback(() => {
    setFormContent('');
    setFormAction('highlight');
    setFormReftarget('');
    setFormTargetvalue('');
    setFormRequirements('');
    setFormSrc('');
    setFormAlt('');
    setFormPrompt('');
    setFormVariableName('');
  }, []);

  // Populate form fields from a block
  const populateFormFromBlock = useCallback(
    (block: JsonBlock) => {
      resetFormFields();
      if (isMarkdownBlock(block)) {
        setFormContent(block.content);
      } else if (isInteractiveBlock(block)) {
        setFormContent(block.content);
        setFormAction(block.action);
        setFormReftarget(block.reftarget || '');
        setFormTargetvalue(block.targetvalue || '');
        setFormRequirements(block.requirements?.join(', ') || '');
      } else if (isImageBlock(block)) {
        setFormSrc(block.src);
        setFormAlt(block.alt || '');
      } else if (isVideoBlock(block)) {
        setFormSrc(block.src);
      } else if (isInputBlock(block)) {
        setFormPrompt(block.prompt);
        setFormVariableName(block.variableName);
      }
    },
    [resetFormFields]
  );

  // Build block from form fields
  const buildBlockFromForm = useCallback(
    (type: BlockType): JsonBlock => {
      switch (type) {
        case 'markdown':
          return { type: 'markdown', content: formContent };
        case 'interactive': {
          const reqArray = formRequirements
            .split(',')
            .map((r) => r.trim())
            .filter((r) => r.length > 0);
          return {
            type: 'interactive',
            action: formAction,
            reftarget: formReftarget,
            content: formContent,
            ...(formTargetvalue && { targetvalue: formTargetvalue }),
            ...(reqArray.length > 0 && { requirements: reqArray }),
          };
        }
        case 'image':
          return {
            type: 'image',
            src: formSrc,
            ...(formAlt && { alt: formAlt }),
          };
        case 'video':
          return { type: 'video', src: formSrc };
        case 'input':
          return {
            type: 'input',
            prompt: formPrompt,
            inputType: 'text',
            variableName: formVariableName,
          };
        default:
          return createDefaultBlock(type);
      }
    },
    [
      formContent,
      formAction,
      formReftarget,
      formTargetvalue,
      formRequirements,
      formSrc,
      formAlt,
      formPrompt,
      formVariableName,
    ]
  );

  // Handle drag end
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) {
        return;
      }
      const oldIndex = parseInt(String(active.id).replace('branch-block-', ''), 10);
      const newIndex = parseInt(String(over.id).replace('branch-block-', ''), 10);
      if (isNaN(oldIndex) || isNaN(newIndex)) {
        return;
      }
      const newBlocks = [...blocks];
      const [movedBlock] = newBlocks.splice(oldIndex, 1);
      newBlocks.splice(newIndex, 0, movedBlock);
      onChange(newBlocks);
    },
    [blocks, onChange]
  );

  // Add a new block
  const handleAddBlock = useCallback(() => {
    const newBlock = buildBlockFromForm(newBlockType);
    onChange([...blocks, newBlock]);
    setShowAddForm(false);
    resetFormFields();
    setNewBlockType('markdown');
  }, [blocks, onChange, newBlockType, buildBlockFromForm, resetFormFields]);

  // Start editing a block
  const handleStartEdit = useCallback(
    (index: number) => {
      const block = blocks[index];
      setEditingIndex(index);
      setNewBlockType(block.type as BlockType);
      populateFormFromBlock(block);
    },
    [blocks, populateFormFromBlock]
  );

  // Save edited block
  const handleSaveEdit = useCallback(() => {
    if (editingIndex === null) {
      return;
    }
    const blockType = blocks[editingIndex].type as BlockType;

    // Safety check: prevent data loss for types without inline editing support
    // These types should use handleCancelEdit instead (UI shows Close button, not Save)
    if (!INLINE_EDITABLE_TYPES.includes(blockType)) {
      setEditingIndex(null);
      resetFormFields();
      return;
    }

    const updatedBlock = buildBlockFromForm(blockType);
    const newBlocks = [...blocks];
    newBlocks[editingIndex] = updatedBlock;
    onChange(newBlocks);
    setEditingIndex(null);
    resetFormFields();
  }, [editingIndex, blocks, onChange, buildBlockFromForm, resetFormFields]);

  // Cancel editing
  const handleCancelEdit = useCallback(() => {
    setEditingIndex(null);
    resetFormFields();
  }, [resetFormFields]);

  // Delete a block
  const handleDeleteBlock = useCallback(
    (index: number) => {
      const newBlocks = blocks.filter((_, i) => i !== index);
      onChange(newBlocks);
      if (editingIndex === index) {
        // Deleted the block being edited
        setEditingIndex(null);
        resetFormFields();
      } else if (editingIndex !== null && editingIndex > index) {
        // Deleted a block before the one being edited - adjust index
        setEditingIndex(editingIndex - 1);
      }
    },
    [blocks, onChange, editingIndex, resetFormFields]
  );

  // Start element picker for reftarget
  const startPicker = useCallback(() => {
    onPickerModeChange?.(true, (selector: string) => {
      setFormReftarget(selector);
    });
  }, [onPickerModeChange]);

  // Handle requirement chip click
  const handleRequirementClick = useCallback((req: string) => {
    setFormRequirements((prev) => {
      if (prev.includes(req)) {
        return prev;
      }
      return prev ? `${prev}, ${req}` : req;
    });
  }, []);

  // Render form fields based on block type
  // Note: formStyles is passed from parent scope where useStyles2 was called
  const renderFormFields = (type: BlockType) => {
    switch (type) {
      case 'markdown':
        return (
          <Field label="Content" description="Markdown formatted text">
            <TextArea
              value={formContent}
              onChange={(e) => setFormContent(e.currentTarget.value)}
              rows={3}
              placeholder="Enter markdown content..."
            />
          </Field>
        );

      case 'interactive':
        return (
          <>
            <div className={styles.formRow}>
              <Field label="Action" style={{ flex: 1 }}>
                <Combobox
                  options={ACTION_OPTIONS}
                  value={formAction}
                  onChange={(v) => setFormAction(v.value)}
                />
              </Field>
              <Field label="Target" style={{ flex: 2 }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <Input
                    value={formReftarget}
                    onChange={(e) => setFormReftarget(e.currentTarget.value)}
                    placeholder="CSS selector or button text"
                    style={{ flex: 1 }}
                  />
                  {onPickerModeChange && (
                    <Button
                      variant="secondary"
                      onClick={startPicker}
                      type="button"
                      icon="crosshair"
                      aria-label="Pick element"
                    />
                  )}
                </div>
              </Field>
            </div>
            <Field label="Description" description="Text shown to the user">
              <TextArea
                value={formContent}
                onChange={(e) => setFormContent(e.currentTarget.value)}
                rows={2}
                placeholder="Click the **Save** button..."
              />
            </Field>
            {formAction === 'formfill' && (
              <Field label="Value" description="Value to fill in the form field">
                <Input
                  value={formTargetvalue}
                  onChange={(e) => setFormTargetvalue(e.currentTarget.value)}
                  placeholder="Value to enter"
                />
              </Field>
            )}
            <Field label="Requirements" description="Conditions that must be met (comma-separated)">
              <Input
                value={formRequirements}
                onChange={(e) => setFormRequirements(e.currentTarget.value)}
                placeholder="e.g., exists-reftarget, on-page:/dashboard"
              />
            </Field>
            <div className={styles.quickAddChips}>
              {COMMON_REQUIREMENTS.slice(0, 5).map((req) => (
                <Badge
                  key={req}
                  text={`+ ${req}`}
                  color="blue"
                  className={styles.requirementChip}
                  onClick={() => handleRequirementClick(req)}
                />
              ))}
            </div>
          </>
        );

      case 'image':
        return (
          <>
            <Field label="Image URL" required>
              <Input
                value={formSrc}
                onChange={(e) => setFormSrc(e.currentTarget.value)}
                placeholder="https://example.com/image.png"
              />
            </Field>
            <Field label="Alt text" description="Description for accessibility">
              <Input
                value={formAlt}
                onChange={(e) => setFormAlt(e.currentTarget.value)}
                placeholder="Descriptive alt text"
              />
            </Field>
          </>
        );

      case 'video':
        return (
          <Field label="Video URL" required description="YouTube or direct video URL">
            <Input
              value={formSrc}
              onChange={(e) => setFormSrc(e.currentTarget.value)}
              placeholder="https://youtube.com/watch?v=..."
            />
          </Field>
        );

      case 'input':
        return (
          <>
            <Field label="Prompt" required description="Question or instruction for the user">
              <TextArea
                value={formPrompt}
                onChange={(e) => setFormPrompt(e.currentTarget.value)}
                rows={2}
                placeholder="Enter your datasource name:"
              />
            </Field>
            <Field label="Variable name" required description="Name to store the response">
              <Input
                value={formVariableName}
                onChange={(e) => setFormVariableName(e.currentTarget.value)}
                placeholder="myVariable"
              />
            </Field>
          </>
        );

      default:
        return (
          <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>
            This block type cannot be edited inline. To modify it, edit the JSON directly or use a dedicated editor for
            this block type.
          </div>
        );
    }
  };

  const headerColorStyle =
    variant === 'success'
      ? { borderLeft: '3px solid var(--success-main, #73BF69)' }
      : { borderLeft: '3px solid var(--warning-main, #FF9830)' };

  return (
    <div className={styles.container}>
      {/* Collapsible header */}
      <div
        className={styles.header}
        style={headerColorStyle}
        onClick={() => setIsExpanded(!isExpanded)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setIsExpanded(!isExpanded)}
      >
        <span className={`${styles.headerIcon} ${isExpanded ? styles.headerIconExpanded : ''}`}>▶</span>
        <span className={styles.headerTitle}>{label}</span>
        <Badge text={`${blocks.length} block${blocks.length !== 1 ? 's' : ''}`} color="blue" />
      </div>

      {/* Blocks list */}
      {isExpanded && (
        <div className={styles.blocksList}>
          {blocks.length === 0 ? (
            <div className={styles.emptyState}>No blocks yet. Add a block below.</div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              measuring={{ droppable: { strategy: MeasuringStrategy.WhileDragging } }}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={blockIds} strategy={verticalListSortingStrategy}>
                {blocks.map((block, index) => {
                  const meta = BLOCK_TYPE_METADATA[block.type as BlockType];
                  const preview = getBlockPreview(block);
                  const isEditing = editingIndex === index;

                  return (
                    <SortableBlockItem
                      key={`branch-block-${index}`}
                      id={`branch-block-${index}`}
                      index={index}
                      disabled={isEditing}
                    >
                      <div className={cx(styles.blockItem, isEditing && styles.blockItemEditing)}>
                        {/* Block header row */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
                          {!isEditing && (
                            <div className={styles.dragHandle}>
                              <span style={{ fontSize: '12px' }}>⋮⋮</span>
                            </div>
                          )}
                          <div className={styles.blockContent}>
                            <div className={styles.blockHeader}>
                              <span>{meta?.icon}</span>
                              <Badge text={meta?.name ?? block.type} color="blue" />
                              {isInteractiveBlock(block) && <Badge text={block.action} color="purple" />}
                            </div>
                            {preview && !isEditing && (
                              <div className={styles.blockPreview} title={preview}>
                                {preview}
                              </div>
                            )}
                          </div>
                          <div className={styles.blockActions}>
                            {!isEditing ? (
                              <>
                                <IconButton
                                  name="edit"
                                  size="sm"
                                  aria-label="Edit"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleStartEdit(index);
                                  }}
                                  className={styles.editButton}
                                  tooltip="Edit block"
                                />
                                <IconButton
                                  name="trash-alt"
                                  size="sm"
                                  aria-label="Delete"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteBlock(index);
                                  }}
                                  className={styles.deleteButton}
                                  tooltip="Delete block"
                                />
                              </>
                            ) : INLINE_EDITABLE_TYPES.includes(block.type as BlockType) ? (
                              <>
                                <Button size="sm" variant="primary" onClick={handleSaveEdit}>
                                  Save
                                </Button>
                                <Button size="sm" variant="secondary" onClick={handleCancelEdit}>
                                  Cancel
                                </Button>
                              </>
                            ) : (
                              <Button size="sm" variant="secondary" onClick={handleCancelEdit}>
                                Close
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Inline edit form */}
                        {isEditing && (
                          <div className={styles.editForm}>{renderFormFields(block.type as BlockType)}</div>
                        )}
                      </div>
                    </SortableBlockItem>
                  );
                })}
              </SortableContext>
            </DndContext>
          )}

          {/* Add block section */}
          <div className={styles.addBlockSection}>
            {showAddForm ? (
              <div className={styles.addBlockForm}>
                <Field label="Block type">
                  <Combobox
                    options={ALLOWED_BRANCH_BLOCK_TYPES.map((t) => ({
                      value: t,
                      label: BLOCK_TYPE_METADATA[t]?.name ?? t,
                      description: BLOCK_TYPE_METADATA[t]?.description,
                    }))}
                    value={newBlockType}
                    onChange={(v) => setNewBlockType(v.value)}
                  />
                </Field>
                {renderFormFields(newBlockType)}
                <div className={styles.formActions}>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setShowAddForm(false);
                      resetFormFields();
                    }}
                  >
                    Cancel
                  </Button>
                  <Button variant="primary" onClick={handleAddBlock}>
                    Add block
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="secondary" icon="plus" onClick={() => setShowAddForm(true)} fullWidth>
                Add block
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

BranchBlocksEditor.displayName = 'BranchBlocksEditor';
