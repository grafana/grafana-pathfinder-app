/**
 * Interactive Block Form
 *
 * Form for creating/editing interactive blocks with DOM picker integration.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { Button, Field, Input, TextArea, Select, Checkbox, Badge, useStyles2, Stack, Switch } from '@grafana/ui';
import { SelectableValue } from '@grafana/data';
import { getBlockFormStyles } from '../block-editor.styles';
import { INTERACTIVE_ACTIONS } from '../constants';
import { COMMON_REQUIREMENTS } from '../../../constants/interactive-config';
import type { BlockFormProps, JsonBlock, JsonInteractiveAction } from '../types';
import type { JsonInteractiveBlock } from '../../../types/json-guide.types';

/** Assistant content type options */
const ASSISTANT_TYPE_OPTIONS: Array<SelectableValue<'query' | 'config' | 'code' | 'text'>> = [
  { value: 'query', label: 'Query', description: 'PromQL, LogQL, or other query languages' },
  { value: 'config', label: 'Configuration', description: 'Configuration values or settings' },
  { value: 'code', label: 'Code', description: 'Code snippets' },
  { value: 'text', label: 'Text', description: 'General text content' },
];

/**
 * Type guard for interactive blocks
 */
function isInteractiveBlock(block: JsonBlock): block is JsonInteractiveBlock {
  return block.type === 'interactive';
}

const ACTION_OPTIONS: Array<SelectableValue<JsonInteractiveAction>> = INTERACTIVE_ACTIONS.map((a) => ({
  value: a.value as JsonInteractiveAction,
  label: a.label,
  description: a.description,
}));

/**
 * Interactive block form component
 */
export function InteractiveBlockForm({
  initialData,
  onSubmit,
  onCancel,
  isEditing = false,
  onPickerModeChange,
}: BlockFormProps) {
  const styles = useStyles2(getBlockFormStyles);

  // Initialize from existing data or defaults
  const initial = initialData && isInteractiveBlock(initialData) ? initialData : null;
  const [action, setAction] = useState<JsonInteractiveAction>(initial?.action ?? 'highlight');
  const [reftarget, setReftarget] = useState(initial?.reftarget ?? '');
  const [targetvalue, setTargetvalue] = useState(initial?.targetvalue ?? '');
  const [content, setContent] = useState(initial?.content ?? '');
  const [tooltip, setTooltip] = useState(initial?.tooltip ?? '');
  const [requirements, setRequirements] = useState(initial?.requirements?.join(', ') ?? '');
  const [objectives, setObjectives] = useState(initial?.objectives?.join(', ') ?? '');
  const [skippable, setSkippable] = useState(initial?.skippable ?? false);
  const [hint, setHint] = useState(initial?.hint ?? '');
  const [formHint, setFormHint] = useState(initial?.formHint ?? '');
  const [showMe, setShowMe] = useState(initial?.showMe ?? true);
  const [doIt, setDoIt] = useState(initial?.doIt ?? true);
  const [completeEarly, setCompleteEarly] = useState(initial?.completeEarly ?? false);
  const [verify, setVerify] = useState(initial?.verify ?? '');

  // AI customization state
  const [assistantEnabled, setAssistantEnabled] = useState(initial?.assistantEnabled ?? false);
  const [assistantId, setAssistantId] = useState(initial?.assistantId ?? '');
  const [assistantType, setAssistantType] = useState<'query' | 'config' | 'code' | 'text'>(
    initial?.assistantType ?? 'query'
  );

  // Start element picker - pass callback to receive selected element
  const startPicker = useCallback(() => {
    onPickerModeChange?.(true, (selector: string) => {
      setReftarget(selector);
    });
  }, [onPickerModeChange]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      // Parse requirements and objectives from comma-separated strings
      const reqArray = requirements
        .split(',')
        .map((r) => r.trim())
        .filter((r) => {
          return r.length > 0;
        });
      const objArray = objectives
        .split(',')
        .map((o) => o.trim())
        .filter((o) => {
          return o.length > 0;
        });

      const block: JsonInteractiveBlock = {
        type: 'interactive',
        action,
        reftarget: reftarget.trim(),
        content: content.trim(),
        ...(targetvalue.trim() && { targetvalue: targetvalue.trim() }),
        ...(tooltip.trim() && { tooltip: tooltip.trim() }),
        ...(reqArray.length > 0 && { requirements: reqArray }),
        ...(objArray.length > 0 && { objectives: objArray }),
        ...(skippable && { skippable }),
        ...(hint.trim() && { hint: hint.trim() }),
        ...(formHint.trim() && { formHint: formHint.trim() }),
        ...(!showMe && { showMe: false }),
        ...(!doIt && { doIt: false }),
        ...(completeEarly && { completeEarly }),
        ...(verify.trim() && { verify: verify.trim() }),
        // AI customization props
        ...(assistantEnabled && { assistantEnabled }),
        ...(assistantEnabled && assistantId.trim() && { assistantId: assistantId.trim() }),
        ...(assistantEnabled && { assistantType }),
      };
      onSubmit(block);
    },
    [
      action,
      reftarget,
      targetvalue,
      content,
      tooltip,
      requirements,
      objectives,
      skippable,
      hint,
      formHint,
      showMe,
      doIt,
      completeEarly,
      verify,
      assistantEnabled,
      assistantId,
      assistantType,
      onSubmit,
    ]
  );

  const handleActionChange = useCallback((option: SelectableValue<JsonInteractiveAction>) => {
    if (option.value) {
      setAction(option.value);
    }
  }, []);

  const handleRequirementClick = useCallback((req: string) => {
    setRequirements((prev) => {
      if (prev.includes(req)) {
        return prev;
      }
      return prev ? `${prev}, ${req}` : req;
    });
  }, []);

  const isValid = reftarget.trim().length > 0 && content.trim().length > 0;
  const showTargetValue = action === 'formfill';

  // Selected action option for Select component
  const selectedAction = useMemo(() => ACTION_OPTIONS.find((o) => o.value === action), [action]);

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      {/* Action Type */}
      <Field label="Action Type" description="The type of interaction to perform" required>
        <Select options={ACTION_OPTIONS} value={selectedAction} onChange={handleActionChange} />
      </Field>

      {/* Target Selector with DOM Picker */}
      <Field label="Target Selector" description="CSS selector or Grafana selector for the target element" required>
        <div className={styles.selectorField}>
          <Input
            value={reftarget}
            onChange={(e) => setReftarget(e.currentTarget.value)}
            placeholder="e.g., button[data-testid='save'], .my-class"
            className={styles.selectorInput}
          />
          <Button
            variant="secondary"
            onClick={startPicker}
            type="button"
            icon="crosshair"
            tooltip="Click an element to capture its selector"
          >
            Pick Element
          </Button>
        </div>
      </Field>

      {/* Target Value (for formfill) */}
      {showTargetValue && (
        <>
          <Field
            label="Value to fill"
            description="The value to enter into the form field. Supports regex patterns: ^pattern, pattern$, or /pattern/flags"
            required
          >
            <Input
              value={targetvalue}
              onChange={(e) => setTargetvalue(e.currentTarget.value)}
              placeholder="e.g., my-dashboard-name or ^https:// (regex)"
            />
          </Field>

          <Field label="Validation hint" description="Hint shown when form validation fails (for regex patterns)">
            <Input
              value={formHint}
              onChange={(e) => setFormHint(e.currentTarget.value)}
              placeholder="e.g., URL must start with https://"
            />
          </Field>
        </>
      )}

      {/* Content */}
      <Field label="Description" description="Markdown description shown to the user" required>
        <TextArea
          value={content}
          onChange={(e) => setContent(e.currentTarget.value)}
          rows={3}
          placeholder="Click the **Save** button to save your changes."
        />
      </Field>

      {/* Tooltip */}
      <Field label="Tooltip" description="Tooltip shown when highlighting the element">
        <Input
          value={tooltip}
          onChange={(e) => setTooltip(e.currentTarget.value)}
          placeholder="Optional tooltip text"
        />
      </Field>

      {/* Requirements */}
      <Field label="Requirements" description="Conditions that must be met (comma-separated)">
        <Input
          value={requirements}
          onChange={(e) => setRequirements(e.currentTarget.value)}
          placeholder="e.g., exists-reftarget, on-page:/dashboards"
        />
      </Field>
      <div className={styles.requirementsContainer}>
        <span className={styles.requirementsLabel}>Quick add:</span>
        <div className={styles.requirementsChips}>
          {COMMON_REQUIREMENTS.map((req) => (
            <Badge
              key={req}
              text={req}
              color="blue"
              className={styles.requirementChip}
              onClick={() => handleRequirementClick(req)}
            />
          ))}
        </div>
      </div>

      {/* Button Visibility */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Button Visibility</div>
        <Stack direction="row" gap={2}>
          <Checkbox
            label="Show 'Show me' button"
            checked={showMe}
            onChange={(e) => setShowMe(e.currentTarget.checked)}
          />
          <Checkbox label="Show 'Do it' button" checked={doIt} onChange={(e) => setDoIt(e.currentTarget.checked)} />
        </Stack>
      </div>

      {/* Advanced Options */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Advanced Options</div>
        <Stack direction="column" gap={1} alignItems="flex-start">
          <Checkbox
            label="Skippable (can be skipped if requirements fail)"
            checked={skippable}
            onChange={(e) => setSkippable(e.currentTarget.checked)}
          />
          <Checkbox
            label="Complete early (mark complete before action)"
            checked={completeEarly}
            onChange={(e) => setCompleteEarly(e.currentTarget.checked)}
          />
        </Stack>
      </div>

      {/* Hint (for skippable) */}
      {skippable && (
        <Field label="Hint" description="Hint shown when step cannot be completed">
          <Input value={hint} onChange={(e) => setHint(e.currentTarget.value)} placeholder="This step requires..." />
        </Field>
      )}

      {/* Verify */}
      <Field label="Verify" description="Post-action verification requirement (e.g., on-page:/dashboard)">
        <Input
          value={verify}
          onChange={(e) => setVerify(e.currentTarget.value)}
          placeholder="e.g., on-page:/dashboards"
        />
      </Field>

      {/* Objectives (optional) */}
      <Field label="Objectives" description="Objectives tracked for completion (comma-separated)">
        <Input
          value={objectives}
          onChange={(e) => setObjectives(e.currentTarget.value)}
          placeholder="e.g., created-dashboard, saved-changes"
        />
      </Field>

      {/* AI Customization Section */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>AI Customization</div>
        <Field
          label="Enable AI customization"
          description="Allow users to customize this content using Grafana Assistant"
        >
          <Switch value={assistantEnabled} onChange={(e) => setAssistantEnabled(e.currentTarget.checked)} />
        </Field>

        {assistantEnabled && (
          <>
            <Field
              label="Assistant ID"
              description="Unique identifier for storing customizations (auto-generated if empty)"
            >
              <Input
                value={assistantId}
                onChange={(e) => setAssistantId(e.currentTarget.value)}
                placeholder="e.g., my-custom-query"
              />
            </Field>

            <Field label="Content type" description="Type of content being customized (affects AI prompts)">
              <Select
                options={ASSISTANT_TYPE_OPTIONS}
                value={ASSISTANT_TYPE_OPTIONS.find((o) => o.value === assistantType)}
                onChange={(option) => option.value && setAssistantType(option.value)}
              />
            </Field>
          </>
        )}
      </div>

      <div className={styles.footer}>
        <Button variant="secondary" onClick={onCancel} type="button">
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={!isValid}>
          {isEditing ? 'Update Block' : 'Add Block'}
        </Button>
      </div>
    </form>
  );
}

// Add display name for debugging
InteractiveBlockForm.displayName = 'InteractiveBlockForm';
