/**
 * Full Screen Step Editor
 *
 * A modal dialog for editing interactive steps. Supports two modes:
 * 1. Create mode: When a click is intercepted in full screen mode
 * 2. Edit mode: When editing an existing interactive element
 *
 * Pre-filled with the detected/existing attributes, allows the author
 * to modify description, action type, requirements, and comments.
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  Modal,
  Button,
  Field,
  Input,
  TextArea,
  Stack,
  Badge,
  Alert,
  HorizontalGroup,
  useStyles2,
  Select,
} from '@grafana/ui';
import { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { css } from '@emotion/css';
import type { PendingClickInfo, SectionInfo, StepEditorData } from './hooks/useFullScreenMode';
import type { InteractiveElementType } from './types';
import { COMMON_REQUIREMENTS, getActionIcon, ACTION_TYPES } from '../../constants/interactive-config';
import { testIds } from '../testIds';

// Re-export types for consumers
export type { StepEditorData, SectionInfo };

/**
 * Data for a nested step within a multistep/guided block
 */
export interface NestedStepData {
  /** Action type for this step */
  actionType: string;
  /** CSS selector or element reference */
  refTarget: string;
  /** Target value (for formfill) */
  targetValue?: string;
  /** Requirements for this step */
  requirements?: string;
  /** Interactive comment/tooltip for this step */
  interactiveComment?: string;
  /** Display text/description */
  textContent?: string;
  /** Position in document (for editing) */
  pos?: number;
}

/**
 * Data for editing an existing interactive element
 */
export interface EditElementData {
  /** Type of element being edited */
  type: InteractiveElementType;
  /** Current attributes */
  attributes: Record<string, string>;
  /** Position in document */
  pos: number;
  /** Text content (for description) */
  textContent?: string;
  /** Comment text (for interactive comments) */
  commentText?: string;
  /** Nested steps (for multistep/guided blocks) */
  nestedSteps?: NestedStepData[];
  /** ID of the section this element is in (if any) */
  sectionId?: string;
}

/**
 * Data returned when saving an edit
 */
export interface EditSaveData {
  actionType: string;
  refTarget: string;
  targetValue?: string;
  requirements?: string;
  interactiveComment?: string;
  description?: string;
  /** Updated nested steps (for multistep/guided blocks) */
  nestedSteps?: NestedStepData[];
  /** Section to move this element into (for edit mode) */
  sectionId?: string;
  /** Title for new section (if sectionId is 'new') */
  newSectionTitle?: string;
  /** ID for new section (if sectionId is 'new') */
  newSectionId?: string;
}

const getStyles = (theme: GrafanaTheme2) => ({
  modal: css({
    width: '550px',
    maxWidth: '95vw',
  }),
  content: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
  }),
  selectorBox: css({
    padding: theme.spacing(1.5),
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  selectorLabel: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing(0.5),
    display: 'block',
  }),
  selectorCode: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.primary,
    wordBreak: 'break-all',
    overflowWrap: 'break-word',
  }),
  actionBadge: css({
    marginLeft: theme.spacing(1),
  }),
  buttonGroup: css({
    display: 'flex',
    gap: theme.spacing(1),
    justifyContent: 'flex-end',
    marginTop: theme.spacing(2),
  }),
  warningBox: css({
    marginTop: theme.spacing(1),
  }),
  requirementsHelp: css({
    marginTop: theme.spacing(1),
  }),
  skipButton: css({
    marginRight: 'auto',
  }),
  deleteButton: css({
    marginRight: 'auto',
  }),
  header: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  headerIcon: css({
    fontSize: '1.5em',
  }),
  actionTypeRow: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  actionTypeLabel: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    whiteSpace: 'nowrap',
  }),
  actionTypeSelect: css({
    minWidth: '150px',
  }),
  sectionFields: css({
    marginTop: theme.spacing(1),
    paddingLeft: theme.spacing(2),
    borderLeft: `2px solid ${theme.colors.border.medium}`,
  }),
  collapsibleSection: css({
    marginTop: theme.spacing(1),
  }),
  // Nested steps styles
  nestedStepsSection: css({
    marginTop: theme.spacing(2),
    padding: theme.spacing(2),
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  nestedStepsHeader: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing(1.5),
  }),
  nestedStepsTitle: css({
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    margin: 0,
  }),
  nestedStepsList: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
  }),
  nestedStepItem: css({
    padding: theme.spacing(1.5),
    backgroundColor: theme.colors.background.primary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  nestedStepHeader: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(1),
  }),
  nestedStepNumber: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    backgroundColor: theme.colors.primary.main,
    color: theme.colors.primary.contrastText,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    flexShrink: 0,
  }),
  nestedStepAction: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  nestedStepFields: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  }),
  nestedStepRow: css({
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: theme.spacing(1),
  }),
  nestedStepSelector: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    backgroundColor: theme.colors.background.secondary,
    padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
    borderRadius: theme.shape.radius.default,
    wordBreak: 'break-all',
    marginBottom: theme.spacing(0.5),
  }),
});

export interface FullScreenStepEditorProps {
  /** Whether the editor is open */
  isOpen: boolean;
  /** Pending click information (create mode) */
  pendingClick?: PendingClickInfo | null;
  /** Existing element data (edit mode) */
  editData?: EditElementData | null;
  /** Called when the step is saved and click should execute (create mode) */
  onSaveAndClick?: (data: StepEditorData) => void;
  /** Called when multistep/guided is selected - saves first step and starts bundling mode (create mode) */
  onSaveAndStartBundling?: (data: StepEditorData) => void;
  /** Called to skip this click without recording (create mode) */
  onSkip?: () => void;
  /** Called to save edits (edit mode) */
  onSaveEdit?: (data: EditSaveData) => void;
  /** Called to delete the element (edit mode) */
  onDelete?: () => void;
  /** Called to cancel editing */
  onCancel: () => void;
  /** Current step number (for display in create mode) */
  stepNumber?: number;
  /** Existing sections in the document */
  existingSections?: SectionInfo[];
  /** Initial section ID to pre-select (from cursor position) */
  initialSectionId?: string | null;
  /** Whether this is a bundling review (after recording multistep/guided) */
  isBundlingReview?: boolean;
  /** Action type for bundling review (multistep or guided) */
  bundlingActionType?: string;
  /** Pre-recorded nested steps for bundling review */
  bundledNestedSteps?: NestedStepData[];
  /** Called to confirm bundling and create the element (bundling review mode) */
  onConfirmBundling?: (data: StepEditorData, updatedSteps: NestedStepData[]) => void;
}

/**
 * Step editor modal for full screen authoring mode and element editing
 */
// Available action types for the selector
const ACTION_TYPE_OPTIONS: Array<SelectableValue<string>> = [
  {
    label: `${getActionIcon(ACTION_TYPES.HIGHLIGHT)} Highlight`,
    value: ACTION_TYPES.HIGHLIGHT,
    description: 'Click/Highlight an element',
  },
  { label: `${getActionIcon(ACTION_TYPES.BUTTON)} Button`, value: ACTION_TYPES.BUTTON, description: 'Click by text' },
  {
    label: `${getActionIcon(ACTION_TYPES.HOVER)} Hover`,
    value: ACTION_TYPES.HOVER,
    description: 'Hover over an element',
  },
  {
    label: `${getActionIcon(ACTION_TYPES.FORM_FILL)} Form Fill`,
    value: ACTION_TYPES.FORM_FILL,
    description: 'Fill a form field',
  },
  {
    label: `${getActionIcon(ACTION_TYPES.NAVIGATE)} Navigate`,
    value: ACTION_TYPES.NAVIGATE,
    description: 'Navigate to a URL',
  },
  {
    label: `${getActionIcon(ACTION_TYPES.MULTISTEP)} Multistep`,
    value: ACTION_TYPES.MULTISTEP,
    description: 'Multiple actions combined (dropdown, modal)',
  },
  { label: `🎯 Guided`, value: 'guided', description: 'Guided sequence with hover/highlight/action' },
  {
    label: `${getActionIcon(ACTION_TYPES.NOOP)} Info Only`,
    value: ACTION_TYPES.NOOP,
    description: 'No action, just display',
  },
];

// Action types that trigger bundling mode
const BUNDLING_ACTION_TYPES = [ACTION_TYPES.MULTISTEP, 'guided'] as const;

export function FullScreenStepEditor({
  isOpen,
  pendingClick,
  editData,
  onSaveAndClick,
  onSaveAndStartBundling,
  onSkip,
  onSaveEdit,
  onDelete,
  onCancel,
  stepNumber = 1,
  existingSections = [],
  initialSectionId,
  isBundlingReview = false,
  bundlingActionType,
  bundledNestedSteps,
  onConfirmBundling,
}: FullScreenStepEditorProps) {
  const styles = useStyles2(getStyles);
  const [description, setDescription] = useState('');
  const [refTarget, setRefTarget] = useState('');
  const [targetValue, setTargetValue] = useState('');
  const [requirements, setRequirements] = useState('');
  const [selectedActionType, setSelectedActionType] = useState<string>('');
  const [interactiveComment, setInteractiveComment] = useState('');
  const [formFillValue, setFormFillValue] = useState('');
  const [sectionMode, setSectionMode] = useState<'none' | 'new' | string>('none');
  const [newSectionId, setNewSectionId] = useState('');
  const [newSectionTitle, setNewSectionTitle] = useState('');
  const [nestedSteps, setNestedSteps] = useState<NestedStepData[]>([]);
  const descriptionInputRef = useRef<HTMLTextAreaElement>(null);

  // Determine if we're in edit mode, create mode, or bundling review mode
  const isEditMode = !!editData && !pendingClick && !isBundlingReview;
  const isCreateMode = !!pendingClick && !editData && !isBundlingReview;

  // Check if we're editing a multistep/guided block with nested steps
  const isMultistepOrGuided = selectedActionType === ACTION_TYPES.MULTISTEP || selectedActionType === 'guided';
  const hasNestedSteps = (isEditMode || isBundlingReview) && isMultistepOrGuided && nestedSteps.length > 0;

  // Check if current action type triggers bundling mode
  const isBundlingAction =
    isCreateMode && BUNDLING_ACTION_TYPES.includes(selectedActionType as (typeof BUNDLING_ACTION_TYPES)[number]);

  // Check if current action type is formfill (to show value field)
  const isFormFillAction = selectedActionType === ACTION_TYPES.FORM_FILL;

  // Pre-fill form when pendingClick changes (create mode)
  // Also pre-populate section from initialSectionId (cursor position)
  useEffect(() => {
    if (pendingClick && isCreateMode) {
      queueMicrotask(() => {
        setDescription(pendingClick.description);
        setRefTarget(pendingClick.selector);
        setTargetValue('');
        setRequirements('');
        setSelectedActionType(pendingClick.action);
        setInteractiveComment('');
        setFormFillValue('');
        // Pre-select section from cursor position if available
        setSectionMode(initialSectionId || 'none');
        setNewSectionId('');
        setNewSectionTitle('');
      });
    }
  }, [pendingClick, isCreateMode, initialSectionId]);

  // Pre-fill form when editData changes (edit mode)
  useEffect(() => {
    if (editData && isEditMode) {
      queueMicrotask(() => {
        const attrs = editData.attributes;
        setDescription(editData.textContent || '');
        setRefTarget(attrs['data-reftarget'] || '');
        setTargetValue(attrs['data-targetvalue'] || '');
        setRequirements(attrs['data-requirements'] || '');
        setSelectedActionType(attrs['data-targetaction'] || ACTION_TYPES.HIGHLIGHT);
        setInteractiveComment(editData.commentText || '');
        setFormFillValue(attrs['data-targetvalue'] || '');
        // Pre-populate section if the element is inside a section
        setSectionMode(editData.sectionId || 'none');
        setNewSectionId('');
        setNewSectionTitle('');
        // Populate nested steps if editing a multistep/guided block
        setNestedSteps(editData.nestedSteps || []);
      });
    }
  }, [editData, isEditMode]);

  // Pre-fill form for bundling review mode (after recording multistep/guided)
  useEffect(() => {
    if (isBundlingReview && bundledNestedSteps && bundledNestedSteps.length > 0) {
      queueMicrotask(() => {
        // Set action type from bundling
        setSelectedActionType(bundlingActionType || ACTION_TYPES.MULTISTEP);
        // Default description based on first step
        const defaultDesc =
          bundledNestedSteps.length > 1
            ? `Complete ${bundledNestedSteps.length} steps`
            : bundledNestedSteps[0]?.textContent || 'Complete the action';
        setDescription(defaultDesc);
        setRefTarget('');
        setTargetValue('');
        setRequirements('');
        setInteractiveComment('');
        setFormFillValue('');
        // Pre-select section from initial context if available
        setSectionMode(initialSectionId || 'none');
        setNewSectionId('');
        setNewSectionTitle('');
        // Populate the recorded steps for editing
        setNestedSteps(bundledNestedSteps);
      });
    }
  }, [isBundlingReview, bundledNestedSteps, bundlingActionType, initialSectionId]);

  // Memoize selected option to prevent re-renders
  const selectedOption = useMemo(
    () => ACTION_TYPE_OPTIONS.find((opt) => opt.value === selectedActionType) || null,
    [selectedActionType]
  );

  // Focus description input when modal opens
  useEffect(() => {
    if (isOpen && descriptionInputRef.current) {
      const timer = setTimeout(() => {
        descriptionInputRef.current?.focus();
        descriptionInputRef.current?.select();
      }, 100);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isOpen]);

  // Build step editor data from form state (create mode)
  const buildStepData = useCallback((): StepEditorData => {
    const data: StepEditorData = {
      description: description.trim(),
      actionType: selectedActionType,
      requirements: requirements.trim() || undefined,
      interactiveComment: interactiveComment.trim() || undefined,
    };

    if (selectedActionType === ACTION_TYPES.FORM_FILL && formFillValue.trim()) {
      data.formFillValue = formFillValue.trim();
    }

    if (sectionMode === 'new' && newSectionId.trim()) {
      data.sectionId = newSectionId.trim();
      data.sectionTitle = newSectionTitle.trim() || undefined;
    } else if (sectionMode !== 'none' && sectionMode !== 'new') {
      data.sectionId = sectionMode;
    }

    return data;
  }, [
    description,
    selectedActionType,
    requirements,
    interactiveComment,
    formFillValue,
    sectionMode,
    newSectionId,
    newSectionTitle,
  ]);

  // Build edit save data from form state (edit mode)
  const buildEditData = useCallback((): EditSaveData => {
    const data: EditSaveData = {
      actionType: selectedActionType,
      refTarget: refTarget.trim(),
      targetValue: targetValue.trim() || undefined,
      requirements: requirements.trim() || undefined,
      interactiveComment: interactiveComment.trim() || undefined,
      description: description.trim() || undefined,
      // Include nested steps for multistep/guided
      nestedSteps: nestedSteps.length > 0 ? nestedSteps : undefined,
    };

    // Include section info if moving to a section
    if (sectionMode === 'new' && newSectionId.trim()) {
      data.sectionId = 'new';
      data.newSectionId = newSectionId.trim();
      data.newSectionTitle = newSectionTitle.trim() || undefined;
    } else if (sectionMode !== 'none') {
      data.sectionId = sectionMode;
    }

    return data;
  }, [
    selectedActionType,
    refTarget,
    targetValue,
    requirements,
    interactiveComment,
    description,
    nestedSteps,
    sectionMode,
    newSectionId,
    newSectionTitle,
  ]);

  // Handler to update a specific nested step
  const updateNestedStep = useCallback((index: number, field: keyof NestedStepData, value: string) => {
    setNestedSteps((prev) => prev.map((step, i) => (i === index ? { ...step, [field]: value || undefined } : step)));
  }, []);

  const handleSave = useCallback(() => {
    if (isBundlingReview && onConfirmBundling) {
      // Bundling review mode - confirm and create the element
      if (description.trim() && selectedActionType) {
        onConfirmBundling(buildStepData(), nestedSteps);
      }
    } else if (isEditMode && onSaveEdit) {
      // For multistep/guided, we don't require refTarget on the parent
      const isValid = isMultistepOrGuided
        ? selectedActionType.length > 0
        : selectedActionType.length > 0 && refTarget.trim().length > 0;
      if (isValid) {
        onSaveEdit(buildEditData());
      }
    } else if (isCreateMode && onSaveAndClick) {
      if (description.trim() && selectedActionType) {
        onSaveAndClick(buildStepData());
      }
    }
  }, [
    isBundlingReview,
    isEditMode,
    isCreateMode,
    isMultistepOrGuided,
    onConfirmBundling,
    onSaveEdit,
    onSaveAndClick,
    description,
    selectedActionType,
    refTarget,
    nestedSteps,
    buildStepData,
    buildEditData,
  ]);

  const handleSaveAndStartBundling = useCallback(() => {
    if (description.trim() && selectedActionType && onSaveAndStartBundling) {
      onSaveAndStartBundling(buildStepData());
    }
  }, [description, selectedActionType, onSaveAndStartBundling, buildStepData]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (isBundlingAction) {
          handleSaveAndStartBundling();
        } else {
          handleSave();
        }
      }
    },
    [handleSave, handleSaveAndStartBundling, isBundlingAction]
  );

  const handleRequirementClick = useCallback((req: string) => {
    setRequirements((prev) => {
      if (prev.includes(req)) {
        return prev;
      }
      return prev ? `${prev}, ${req}` : req;
    });
  }, []);

  const handleSectionTitleChange = useCallback((title: string) => {
    setNewSectionTitle(title);
    const generatedId = title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
    if (generatedId) {
      setNewSectionId(`section-${generatedId}`);
    }
  }, []);

  const sectionOptions: Array<SelectableValue<string>> = useMemo(() => {
    const options: Array<SelectableValue<string>> = [
      { label: 'None (standalone step)', value: 'none' },
      { label: '+ Create new section...', value: 'new' },
    ];

    existingSections.forEach((section) => {
      options.push({
        label: section.title || section.id,
        value: section.id,
        description: section.title ? `ID: ${section.id}` : undefined,
      });
    });

    return options;
  }, [existingSections]);

  // Allow bundling review even without pendingClick or editData
  if (!isOpen || (!pendingClick && !editData && !isBundlingReview)) {
    return null;
  }

  const actionIcon = getActionIcon(selectedActionType || pendingClick?.action || '');
  // For multistep/guided and bundling review, we don't require refTarget on the parent
  const isValid =
    isBundlingReview || isEditMode
      ? isMultistepOrGuided
        ? selectedActionType.length > 0
        : selectedActionType.length > 0 && refTarget.trim().length > 0
      : description.trim().length > 0 && selectedActionType.length > 0;
  const hasWarnings = pendingClick?.warnings?.length ?? 0 > 0;
  const isNonUnique = pendingClick?.selectorInfo?.isUnique === false;

  // Determine selector to display
  const displaySelector = pendingClick?.selector || editData?.attributes['data-reftarget'] || refTarget;

  // Build modal title
  const modalTitle = isBundlingReview ? (
    <div className={styles.header}>
      <span className={styles.headerIcon}>{actionIcon}</span>
      <span>Review {nestedSteps.length} Recorded Steps</span>
    </div>
  ) : isEditMode ? (
    <div className={styles.header}>
      <span className={styles.headerIcon}>{actionIcon}</span>
      <span>Edit {selectedActionType || 'Step'}</span>
    </div>
  ) : (
    <div className={styles.header}>
      <span className={styles.headerIcon}>{actionIcon}</span>
      <span>
        Step {stepNumber}: {selectedActionType || pendingClick?.action}
      </span>
    </div>
  );

  return (
    <Modal
      title={modalTitle}
      isOpen={isOpen}
      onDismiss={onCancel}
      className={styles.modal}
      data-testid={testIds.wysiwygEditor.fullScreen.stepEditor.modal}
    >
      <div className={styles.content} data-fullscreen-step-editor>
        {/* Detected/Current selector info - hidden in bundling review mode */}
        {!isBundlingReview && (
          <div className={styles.selectorBox} data-testid={testIds.wysiwygEditor.fullScreen.stepEditor.selectorDisplay}>
            <span className={styles.selectorLabel}>
              {isEditMode ? 'Target selector:' : 'Detected selector:'}
              {pendingClick?.selectorInfo?.contextStrategy && (
                <Badge text={pendingClick.selectorInfo.contextStrategy} color="purple" className={styles.actionBadge} />
              )}
            </span>
            {isEditMode ? (
              <Input
                value={refTarget}
                onChange={(e) => setRefTarget(e.currentTarget.value)}
                placeholder="CSS selector or element reference"
              />
            ) : (
              <code className={styles.selectorCode}>{displaySelector}</code>
            )}
          </div>
        )}

        {/* Action Type Selector */}
        <Field label="Action type" description="Choose the type of interaction for this step">
          <Select
            options={ACTION_TYPE_OPTIONS}
            value={selectedOption}
            onChange={(option) => setSelectedActionType(option?.value || '')}
            className={styles.actionTypeSelect}
            menuPlacement="bottom"
            data-testid={testIds.wysiwygEditor.fullScreen.stepEditor.actionTypeSelect}
          />
        </Field>

        {/* Warnings (create mode only) */}
        {isCreateMode && (hasWarnings || isNonUnique) && (
          <div className={styles.warningBox}>
            {hasWarnings && (
              <Alert title="Selector warnings" severity="warning">
                <ul>
                  {pendingClick?.warnings?.map((warning, idx) => (
                    <li key={idx}>{warning}</li>
                  ))}
                </ul>
              </Alert>
            )}
            {isNonUnique && (
              <Alert title="Non-unique selector" severity="warning">
                This selector matches {pendingClick?.selectorInfo?.matchCount} elements. Consider adding more specific
                attributes to the target element.
              </Alert>
            )}
          </div>
        )}

        {/* Description field */}
        <Field
          label="Step description"
          description="Describe what this step does (shown to users in the guide)"
          required={isCreateMode}
        >
          <TextArea
            ref={descriptionInputRef}
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g., Click the Save button to save your changes"
            rows={2}
            data-testid={testIds.wysiwygEditor.fullScreen.stepEditor.descriptionInput}
          />
        </Field>

        {/* Target Value field - for formfill or when editing */}
        {(isFormFillAction || (isEditMode && targetValue)) && (
          <Field label="Target value" description="The value to enter or match">
            <Input
              value={isFormFillAction ? formFillValue : targetValue}
              onChange={(e) =>
                isFormFillAction ? setFormFillValue(e.currentTarget.value) : setTargetValue(e.currentTarget.value)
              }
              placeholder="e.g., my-dashboard-name"
            />
          </Field>
        )}

        {/* Requirements field */}
        <Field label="Requirements (optional)" description="Conditions that must be met before this step can execute">
          <Stack direction="column" gap={1}>
            <Input
              value={requirements}
              onChange={(e) => setRequirements(e.currentTarget.value)}
              placeholder="e.g., navmenu-open, on-page:/dashboards"
              data-testid={testIds.wysiwygEditor.fullScreen.stepEditor.requirementsInput}
            />
            <div className={styles.requirementsHelp}>
              <HorizontalGroup spacing="xs" wrap>
                {COMMON_REQUIREMENTS.slice(0, 5).map((req) => (
                  <Button key={req} size="sm" variant="secondary" onClick={() => handleRequirementClick(req)}>
                    {req}
                  </Button>
                ))}
              </HorizontalGroup>
            </div>
          </Stack>
        </Field>

        {/* Interactive Comment field */}
        <Field
          label="Interactive Comment (optional)"
          description="Educational context shown before the step action (explains WHY)"
        >
          <TextArea
            value={interactiveComment}
            onChange={(e) => setInteractiveComment(e.currentTarget.value)}
            placeholder="e.g., The Settings menu contains all configuration options for your dashboard..."
            rows={2}
            data-testid={testIds.wysiwygEditor.fullScreen.stepEditor.commentInput}
          />
        </Field>

        {/* Section management (available in both create and edit mode) */}
        <Field
          label="Section (optional)"
          description={isEditMode ? 'Move this step into a section' : 'Group this step into a section/sequence'}
        >
          <Stack direction="column" gap={1}>
            <Select
              options={sectionOptions}
              value={sectionOptions.find((opt) => opt.value === sectionMode) || sectionOptions[0]}
              onChange={(option) => setSectionMode(option?.value || 'none')}
              menuPlacement="top"
              data-testid={testIds.wysiwygEditor.fullScreen.stepEditor.sectionSelect}
            />

            {sectionMode === 'new' && (
              <div className={styles.sectionFields}>
                <Field label="Section Title" description="Heading displayed above the section">
                  <Input
                    value={newSectionTitle}
                    onChange={(e) => handleSectionTitleChange(e.currentTarget.value)}
                    placeholder="e.g., Configure Data Source"
                  />
                </Field>
                <Field label="Section ID" description="Unique identifier for the section (auto-generated)">
                  <Input
                    value={newSectionId}
                    onChange={(e) => setNewSectionId(e.currentTarget.value)}
                    placeholder="e.g., section-configure-datasource"
                  />
                </Field>
              </div>
            )}
          </Stack>
        </Field>

        {/* Nested steps for multistep/guided blocks (edit mode only) */}
        {hasNestedSteps && (
          <div className={styles.nestedStepsSection}>
            <div className={styles.nestedStepsHeader}>
              <h4 className={styles.nestedStepsTitle}>Steps ({nestedSteps.length})</h4>
            </div>
            <div className={styles.nestedStepsList}>
              {nestedSteps.map((step, index) => (
                <div key={index} className={styles.nestedStepItem}>
                  <div className={styles.nestedStepHeader}>
                    <span className={styles.nestedStepNumber}>{index + 1}</span>
                    <span className={styles.nestedStepAction}>
                      {getActionIcon(step.actionType)} {step.actionType}
                    </span>
                  </div>
                  <div className={styles.nestedStepSelector}>{step.refTarget}</div>
                  <div className={styles.nestedStepFields}>
                    <div className={styles.nestedStepRow}>
                      <Field label="Selector" style={{ margin: 0 }}>
                        <Input
                          value={step.refTarget || ''}
                          onChange={(e) => updateNestedStep(index, 'refTarget', e.currentTarget.value)}
                          placeholder="CSS selector"
                        />
                      </Field>
                      <Field label="Action" style={{ margin: 0 }}>
                        <Select
                          options={ACTION_TYPE_OPTIONS.filter(
                            (opt) => opt.value !== ACTION_TYPES.MULTISTEP && opt.value !== 'guided'
                          )}
                          value={ACTION_TYPE_OPTIONS.find((opt) => opt.value === step.actionType) || null}
                          onChange={(opt) => updateNestedStep(index, 'actionType', opt?.value || '')}
                          menuPlacement="auto"
                        />
                      </Field>
                    </div>
                    <Field label="Requirements" style={{ margin: 0 }}>
                      <Input
                        value={step.requirements || ''}
                        onChange={(e) => updateNestedStep(index, 'requirements', e.currentTarget.value)}
                        placeholder="e.g., exists-reftarget"
                      />
                    </Field>
                    <Field label="Tooltip/Comment" style={{ margin: 0 }}>
                      <Input
                        value={step.interactiveComment || ''}
                        onChange={(e) => updateNestedStep(index, 'interactiveComment', e.currentTarget.value)}
                        placeholder="Educational context for this step"
                      />
                    </Field>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className={styles.buttonGroup}>
          {/* Left-aligned buttons */}
          {isEditMode && onDelete && (
            <Button
              variant="destructive"
              onClick={onDelete}
              className={styles.deleteButton}
              tooltip="Delete this interactive element"
            >
              Delete
            </Button>
          )}
          {isCreateMode && onSkip && (
            <Button
              variant="secondary"
              onClick={onSkip}
              className={styles.skipButton}
              tooltip="Execute click without recording this step"
              data-testid={testIds.wysiwygEditor.fullScreen.stepEditor.skipButton}
            >
              Skip
            </Button>
          )}

          {/* Right-aligned buttons */}
          <Button
            variant="secondary"
            onClick={onCancel}
            data-testid={testIds.wysiwygEditor.fullScreen.stepEditor.cancelButton}
          >
            Cancel
          </Button>

          {isBundlingReview ? (
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={!isValid}
              tooltip="Create the multistep/guided element with these steps (Ctrl+Enter)"
              data-testid={testIds.wysiwygEditor.fullScreen.stepEditor.saveButton}
            >
              Create {bundlingActionType === 'guided' ? 'Guided' : 'Multistep'}
            </Button>
          ) : isEditMode ? (
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={!isValid}
              tooltip="Save changes (Ctrl+Enter)"
              data-testid={testIds.wysiwygEditor.fullScreen.stepEditor.saveButton}
            >
              Save
            </Button>
          ) : isBundlingAction ? (
            <Button
              variant="primary"
              onClick={handleSaveAndStartBundling}
              disabled={!isValid}
              tooltip="Save this step and start recording additional clicks for the multistep (Ctrl+Enter)"
              data-testid={testIds.wysiwygEditor.fullScreen.stepEditor.saveButton}
            >
              Save &amp; Start Recording
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={!isValid}
              tooltip="Save step and execute click (Ctrl+Enter)"
              data-testid={testIds.wysiwygEditor.fullScreen.stepEditor.saveButton}
            >
              Save &amp; Click
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default FullScreenStepEditor;
