/**
 * Interactive Block Form
 *
 * Form for creating/editing interactive blocks with DOM picker integration.
 */

import React, { useState, useCallback } from 'react';
import {
  Button,
  Field,
  Input,
  TextArea,
  Combobox,
  Checkbox,
  Badge,
  useStyles2,
  Stack,
  Switch,
  type ComboboxOption,
} from '@grafana/ui';
import { getBlockFormStyles } from '../block-editor.styles';
import { INTERACTIVE_ACTIONS } from '../constants';
import { COMMON_REQUIREMENTS } from '../../../constants/interactive-config';
import { TypeSwitchDropdown } from './TypeSwitchDropdown';
import { suggestDefaultRequirements, mergeRequirements } from './requirements-suggester';
import type { BlockFormProps, JsonBlock, JsonInteractiveAction } from '../types';
import type { JsonInteractiveBlock } from '../../../types/json-guide.types';

/** Assistant content type options */
const ASSISTANT_TYPE_OPTIONS: Array<ComboboxOption<'query' | 'config' | 'code' | 'text'>> = [
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

const ACTION_OPTIONS: Array<ComboboxOption<JsonInteractiveAction>> = INTERACTIVE_ACTIONS.map((a) => ({
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
  onSwitchBlockType,
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
  const [lazyRender, setLazyRender] = useState(initial?.lazyRender ?? false);
  const [scrollContainer, setScrollContainer] = useState(initial?.scrollContainer ?? '');

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
      // Auto-add default requirements based on selector pattern
      const suggestions = suggestDefaultRequirements(action, selector);
      if (suggestions.length > 0) {
        setRequirements((prev) => mergeRequirements(prev, suggestions));
      }
    });
  }, [onPickerModeChange, action]);

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

      // noop actions don't need most of these fields
      const isNoopAction = action === 'noop';

      const block: JsonInteractiveBlock = {
        type: 'interactive',
        action,
        // Only include reftarget for non-noop actions
        ...(!isNoopAction && reftarget.trim() && { reftarget: reftarget.trim() }),
        content: content.trim(),
        // The following fields are not relevant for noop actions
        ...(!isNoopAction && targetvalue.trim() && { targetvalue: targetvalue.trim() }),
        ...(!isNoopAction && tooltip.trim() && { tooltip: tooltip.trim() }),
        ...(!isNoopAction && reqArray.length > 0 && { requirements: reqArray }),
        ...(!isNoopAction && objArray.length > 0 && { objectives: objArray }),
        ...(!isNoopAction && skippable && { skippable }),
        ...(!isNoopAction && hint.trim() && { hint: hint.trim() }),
        ...(!isNoopAction && formHint.trim() && { formHint: formHint.trim() }),
        ...(!isNoopAction && !showMe && { showMe: false }),
        ...(!isNoopAction && !doIt && { doIt: false }),
        ...(!isNoopAction && completeEarly && { completeEarly }),
        ...(!isNoopAction && verify.trim() && { verify: verify.trim() }),
        // Lazy render support for virtualized containers (not relevant for noop)
        ...(!isNoopAction && lazyRender && { lazyRender }),
        ...(!isNoopAction && lazyRender && scrollContainer.trim() && { scrollContainer: scrollContainer.trim() }),
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
      lazyRender,
      scrollContainer,
      assistantEnabled,
      assistantId,
      assistantType,
      onSubmit,
    ]
  );

  const handleActionChange = useCallback(
    (option: ComboboxOption<JsonInteractiveAction>) => {
      setAction(option.value);
      // Auto-add default requirements for this action type
      const suggestions = suggestDefaultRequirements(option.value, reftarget);
      if (suggestions.length > 0) {
        setRequirements((prev) => mergeRequirements(prev, suggestions));
      }
    },
    [reftarget]
  );

  const handleRequirementClick = useCallback((req: string) => {
    setRequirements((prev) => {
      if (prev.includes(req)) {
        return prev;
      }
      return prev ? `${prev}, ${req}` : req;
    });
  }, []);

  // noop actions don't require a reftarget since they're informational only
  // navigate actions use reftarget as a path, not a DOM selector
  const isNoop = action === 'noop';
  const isNavigate = action === 'navigate';
  const isValid = (isNoop || reftarget.trim().length > 0) && content.trim().length > 0;
  const showTargetValue = action === 'formfill';

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      {/* Action Type */}
      <Field label="Action Type" description="The type of interaction to perform" required>
        <Combobox options={ACTION_OPTIONS} value={action} onChange={handleActionChange} />
      </Field>

      {/* Navigation path - for navigate actions only */}
      {isNavigate && (
        <Field label="Navigation path" description="URL path to navigate to (e.g., /dashboards or /d/abc123)" required>
          <Input
            value={reftarget}
            onChange={(e) => setReftarget(e.currentTarget.value)}
            placeholder="e.g., /dashboards, /d/abc123, /explore"
          />
        </Field>
      )}

      {/* Target Selector with DOM Picker - hidden for noop and navigate actions */}
      {!isNoop && !isNavigate && (
        <Field label="Target selector" description="CSS selector or Grafana selector for the target element" required>
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
              Pick element
            </Button>
          </div>
        </Field>
      )}

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

      {/* Tooltip - hidden for noop actions */}
      {!isNoop && (
        <Field label="Tooltip" description="Tooltip shown when highlighting the element">
          <Input
            value={tooltip}
            onChange={(e) => setTooltip(e.currentTarget.value)}
            placeholder="Optional tooltip text"
          />
        </Field>
      )}

      {/* Requirements - hidden for noop actions */}
      {!isNoop && (
        <>
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
        </>
      )}

      {/* Button Visibility - hidden for noop actions */}
      {/* Navigate actions always show "Go there" button, no "Show me" option */}
      {!isNoop && !isNavigate && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Button visibility</div>
          <Stack direction="row" gap={2}>
            <Checkbox
              className={styles.checkbox}
              label="Show 'Show me' button"
              checked={showMe}
              onChange={(e) => setShowMe(e.currentTarget.checked)}
            />
            <Checkbox
              className={styles.checkbox}
              label="Show 'Do it' button"
              checked={doIt}
              onChange={(e) => setDoIt(e.currentTarget.checked)}
            />
          </Stack>
        </div>
      )}

      {/* Advanced Options - hidden for noop actions */}
      {!isNoop && (
        <>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Advanced options</div>
            <Stack direction="column" gap={1} alignItems="flex-start">
              <Checkbox
                className={styles.checkbox}
                label="Skippable (can be skipped if requirements fail)"
                checked={skippable}
                onChange={(e) => setSkippable(e.currentTarget.checked)}
              />
              <Checkbox
                className={styles.checkbox}
                label="Complete early (mark complete before action)"
                description="Marks the step as done immediately, before the action executes"
                checked={completeEarly}
                onChange={(e) => setCompleteEarly(e.currentTarget.checked)}
              />
              {/* Lazy render only applies to actions with DOM elements */}
              {!isNavigate && (
                <Checkbox
                  className={styles.checkbox}
                  label="Element may be off-screen (scroll to find)"
                  description="Enable if the target is in a long list that requires scrolling"
                  checked={lazyRender}
                  onChange={(e) => setLazyRender(e.currentTarget.checked)}
                />
              )}
            </Stack>
          </div>

          {/* Lazy Render Scroll Container - only for non-navigate actions */}
          {lazyRender && !isNavigate && (
            <Field
              label="Scroll container"
              description="CSS selector for the scroll container (default: .scrollbar-view)"
            >
              <div className={styles.selectorField}>
                <Input
                  value={scrollContainer}
                  onChange={(e) => setScrollContainer(e.currentTarget.value)}
                  placeholder=".scrollbar-view"
                  className={styles.selectorInput}
                />
                <Button
                  variant="secondary"
                  onClick={() => {
                    onPickerModeChange?.(true, (selector: string) => {
                      setScrollContainer(selector);
                    });
                  }}
                  type="button"
                  icon="crosshair"
                  tooltip="Click an element to capture its selector"
                >
                  Pick Element
                </Button>
              </div>
            </Field>
          )}

          {/* Hint (for skippable) */}
          {skippable && (
            <Field label="Hint" description="Hint shown when step cannot be completed">
              <Input
                value={hint}
                onChange={(e) => setHint(e.currentTarget.value)}
                placeholder="This step requires..."
              />
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
        </>
      )}

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
              <Combobox
                options={ASSISTANT_TYPE_OPTIONS}
                value={assistantType}
                onChange={(option) => setAssistantType(option.value)}
              />
            </Field>
          </>
        )}
      </div>

      <div className={styles.footer}>
        {isEditing && onSwitchBlockType && (
          <div className={styles.footerLeft}>
            <TypeSwitchDropdown currentType="interactive" onSwitch={onSwitchBlockType} blockData={initialData} />
          </div>
        )}
        <Button variant="secondary" onClick={onCancel} type="button">
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={!isValid}>
          {isEditing ? 'Update block' : 'Add block'}
        </Button>
      </div>
    </form>
  );
}

// Add display name for debugging
InteractiveBlockForm.displayName = 'InteractiveBlockForm';
