/**
 * Full Screen Step Editor
 *
 * A modal dialog that appears when a click is intercepted in full screen mode.
 * Pre-filled with the detected selector and action type, allows the author
 * to add a description and requirements before the click is executed.
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
import { COMMON_REQUIREMENTS, getActionIcon, ACTION_TYPES } from '../../constants/interactive-config';
import { testIds } from '../testIds';

// Re-export types for consumers
export type { StepEditorData, SectionInfo };

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
});

export interface FullScreenStepEditorProps {
  /** Whether the editor is open */
  isOpen: boolean;
  /** Pending click information */
  pendingClick: PendingClickInfo | null;
  /** Called when the step is saved and click should execute */
  onSaveAndClick: (data: StepEditorData) => void;
  /** Called when multistep/guided is selected - saves first step and starts bundling mode */
  onSaveAndStartBundling: (data: StepEditorData) => void;
  /** Called to skip this click without recording */
  onSkip: () => void;
  /** Called to cancel editing (returns to active mode without executing) */
  onCancel: () => void;
  /** Current step number (for display) */
  stepNumber?: number;
  /** Existing sections in the document */
  existingSections?: SectionInfo[];
}

/**
 * Step editor modal for full screen authoring mode
 *
 * @example
 * ```tsx
 * <FullScreenStepEditor
 *   isOpen={state === 'editing'}
 *   pendingClick={pendingClick}
 *   onSaveAndClick={(desc, reqs) => saveStepAndClick(desc, reqs)}
 *   onSkip={skipClick}
 *   onCancel={cancelEdit}
 *   stepNumber={recordedSteps.length + 1}
 * />
 * ```
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
  onSaveAndClick,
  onSaveAndStartBundling,
  onSkip,
  onCancel,
  stepNumber = 1,
  existingSections = [],
}: FullScreenStepEditorProps) {
  const styles = useStyles2(getStyles);
  const [description, setDescription] = useState('');
  const [requirements, setRequirements] = useState('');
  const [selectedActionType, setSelectedActionType] = useState<string>('');
  const [interactiveComment, setInteractiveComment] = useState('');
  const [formFillValue, setFormFillValue] = useState('');
  const [sectionMode, setSectionMode] = useState<'none' | 'new' | string>('none');
  const [newSectionId, setNewSectionId] = useState('');
  const [newSectionTitle, setNewSectionTitle] = useState('');
  const descriptionInputRef = useRef<HTMLTextAreaElement>(null);

  // Check if current action type triggers bundling mode
  const isBundlingAction = BUNDLING_ACTION_TYPES.includes(selectedActionType as (typeof BUNDLING_ACTION_TYPES)[number]);

  // Check if current action type is formfill (to show value field)
  const isFormFillAction = selectedActionType === ACTION_TYPES.FORM_FILL;

  // Pre-fill form when pendingClick changes
  // This is an intentional pattern to sync local form state from props when the modal opens
  useEffect(() => {
    if (pendingClick) {
      // Batch state updates to minimize re-renders
      // This pattern is necessary to reset form state when a new click is intercepted
      queueMicrotask(() => {
        setDescription(pendingClick.description);
        setRequirements('');
        setSelectedActionType(pendingClick.action);
        setInteractiveComment('');
        setFormFillValue('');
        setSectionMode('none');
        setNewSectionId('');
        setNewSectionTitle('');
      });
    }
  }, [pendingClick]);

  // Memoize selected option to prevent re-renders
  const selectedOption = useMemo(
    () => ACTION_TYPE_OPTIONS.find((opt) => opt.value === selectedActionType) || null,
    [selectedActionType]
  );

  // Focus description input when modal opens
  useEffect(() => {
    if (isOpen && descriptionInputRef.current) {
      // Small delay to ensure modal is rendered
      const timer = setTimeout(() => {
        descriptionInputRef.current?.focus();
        descriptionInputRef.current?.select();
      }, 100);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isOpen]);

  // Build step editor data from form state
  const buildStepData = useCallback((): StepEditorData => {
    const data: StepEditorData = {
      description: description.trim(),
      actionType: selectedActionType,
      requirements: requirements.trim() || undefined,
      interactiveComment: interactiveComment.trim() || undefined,
    };

    // Include form fill value for formfill action
    if (selectedActionType === ACTION_TYPES.FORM_FILL && formFillValue.trim()) {
      data.formFillValue = formFillValue.trim();
    }

    // Include section data
    if (sectionMode === 'new' && newSectionId.trim()) {
      data.sectionId = newSectionId.trim();
      data.sectionTitle = newSectionTitle.trim() || undefined;
    } else if (sectionMode !== 'none' && sectionMode !== 'new') {
      // Existing section selected
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

  const handleSave = useCallback(() => {
    if (description.trim() && selectedActionType) {
      onSaveAndClick(buildStepData());
    }
  }, [description, selectedActionType, onSaveAndClick, buildStepData]);

  const handleSaveAndStartBundling = useCallback(() => {
    if (description.trim() && selectedActionType) {
      onSaveAndStartBundling(buildStepData());
    }
  }, [description, selectedActionType, onSaveAndStartBundling, buildStepData]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Ctrl/Cmd + Enter to save
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

  // Auto-generate section ID from title
  const handleSectionTitleChange = useCallback((title: string) => {
    setNewSectionTitle(title);
    // Generate ID from title (kebab-case)
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

  // Build section dropdown options
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

  if (!isOpen || !pendingClick) {
    return null;
  }

  const actionIcon = getActionIcon(selectedActionType || pendingClick.action);
  const isValid = description.trim().length > 0 && selectedActionType.length > 0;
  const hasWarnings = pendingClick.warnings.length > 0;
  const isNonUnique = pendingClick.selectorInfo.isUnique === false;

  return (
    <Modal
      title={
        <div className={styles.header}>
          <span className={styles.headerIcon}>{actionIcon}</span>
          <span>
            Step {stepNumber}: {selectedActionType || pendingClick.action}
          </span>
        </div>
      }
      isOpen={isOpen}
      onDismiss={onCancel}
      className={styles.modal}
      data-testid={testIds.wysiwygEditor.fullScreen.stepEditor.modal}
    >
      <div className={styles.content} data-fullscreen-step-editor>
        {/* Detected selector info */}
        <div className={styles.selectorBox} data-testid={testIds.wysiwygEditor.fullScreen.stepEditor.selectorDisplay}>
          <span className={styles.selectorLabel}>
            Detected selector:
            {pendingClick.selectorInfo.contextStrategy && (
              <Badge text={pendingClick.selectorInfo.contextStrategy} color="purple" className={styles.actionBadge} />
            )}
          </span>
          <code className={styles.selectorCode}>{pendingClick.selector}</code>
        </div>

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

        {/* Warnings */}
        {(hasWarnings || isNonUnique) && (
          <div className={styles.warningBox}>
            {hasWarnings && (
              <Alert title="Selector warnings" severity="warning">
                <ul>
                  {pendingClick.warnings.map((warning, idx) => (
                    <li key={idx}>{warning}</li>
                  ))}
                </ul>
              </Alert>
            )}
            {isNonUnique && (
              <Alert title="Non-unique selector" severity="warning">
                This selector matches {pendingClick.selectorInfo.matchCount} elements. Consider adding more specific
                attributes to the target element.
              </Alert>
            )}
          </div>
        )}

        {/* Description field */}
        <Field
          label="Step description"
          description="Describe what this step does (shown to users in the guide)"
          required
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

        {/* Interactive Comment field (optional) */}
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

        {/* Form Fill Value field - only shown for formfill action */}
        {isFormFillAction && (
          <Field label="Value to fill" description="The value to enter into the form field" required>
            <Input
              value={formFillValue}
              onChange={(e) => setFormFillValue(e.currentTarget.value)}
              placeholder="e.g., my-dashboard-name"
            />
          </Field>
        )}

        {/* Section management */}
        <Field label="Section (optional)" description="Group this step into a section/sequence">
          <Stack direction="column" gap={1}>
            <Select
              options={sectionOptions}
              value={sectionOptions.find((opt) => opt.value === sectionMode) || sectionOptions[0]}
              onChange={(option) => setSectionMode(option?.value || 'none')}
              menuPlacement="top"
              data-testid={testIds.wysiwygEditor.fullScreen.stepEditor.sectionSelect}
            />

            {/* New section fields */}
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

        {/* Action buttons */}
        <div className={styles.buttonGroup}>
          <Button
            variant="secondary"
            onClick={onSkip}
            className={styles.skipButton}
            tooltip="Execute click without recording this step"
            data-testid={testIds.wysiwygEditor.fullScreen.stepEditor.skipButton}
          >
            Skip
          </Button>
          <Button
            variant="secondary"
            onClick={onCancel}
            data-testid={testIds.wysiwygEditor.fullScreen.stepEditor.cancelButton}
          >
            Cancel
          </Button>
          {isBundlingAction ? (
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
