/**
 * Conditional Block Form
 *
 * Form for creating/editing conditional blocks.
 * Nested blocks in the whenTrue/whenFalse branches are managed
 * via drag-and-drop in the main editor, not in this form.
 */

import React, { useState, useCallback, useRef } from 'react';
import { Button, Field, Input, TextArea, Badge, useStyles2, Alert, RadioButtonGroup } from '@grafana/ui';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { getBlockFormStyles } from '../block-editor.styles';
import { COMMON_REQUIREMENTS } from '../../../constants/interactive-config';
import type { BlockFormProps, JsonBlock } from '../types';
import type {
  JsonConditionalBlock,
  ConditionalDisplayMode,
  ConditionalSectionConfig,
} from '../../../types/json-guide.types';

/** Options for display mode radio buttons */
const DISPLAY_MODE_OPTIONS = [
  { label: 'Inline', value: 'inline' as const, description: 'Content renders directly' },
  { label: 'Section', value: 'section' as const, description: 'Content wrapped with section styling' },
];

/**
 * Type guard for conditional blocks
 */
function isConditionalBlock(block: JsonBlock): block is JsonConditionalBlock {
  return block.type === 'conditional';
}

/** Styles for branch config sections */
const getBranchConfigStyles = (theme: GrafanaTheme2) => ({
  branchSection: css`
    border: 1px solid ${theme.colors.border.weak};
    border-radius: ${theme.shape.radius.default};
    margin-bottom: ${theme.spacing(2)};
    overflow: hidden;
  `,
  branchHeader: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
    padding: ${theme.spacing(1.5)} ${theme.spacing(2)};
    background: ${theme.colors.background.secondary};
    cursor: pointer;
    user-select: none;
    &:hover {
      background: ${theme.colors.action.hover};
    }
  `,
  branchTitle: css`
    font-weight: ${theme.typography.fontWeightMedium};
    flex: 1;
  `,
  branchIcon: css`
    color: ${theme.colors.text.secondary};
    transition: transform 0.2s ease;
  `,
  branchIconExpanded: css`
    transform: rotate(90deg);
  `,
  branchContent: css`
    padding: ${theme.spacing(2)};
    border-top: 1px solid ${theme.colors.border.weak};
  `,
  passSection: css`
    border-left: 3px solid ${theme.colors.success.main};
  `,
  failSection: css`
    border-left: 3px solid ${theme.colors.warning.main};
  `,
});

/**
 * Conditional block form component
 */
export function ConditionalBlockForm({ initialData, onSubmit, onCancel, isEditing = false }: BlockFormProps) {
  const styles = useStyles2(getBlockFormStyles);
  const branchStyles = useStyles2(getBranchConfigStyles);

  // Initialize from existing data or defaults
  const initial = initialData && isConditionalBlock(initialData) ? initialData : null;
  const [conditions, setConditions] = useState(initial?.conditions?.join(', ') ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [displayMode, setDisplayMode] = useState<ConditionalDisplayMode>(initial?.display ?? 'inline');

  // Per-branch section config state
  const [whenTrueTitle, setWhenTrueTitle] = useState(initial?.whenTrueSectionConfig?.title ?? '');
  const [whenTrueRequirements, setWhenTrueRequirements] = useState(
    initial?.whenTrueSectionConfig?.requirements?.join(', ') ?? ''
  );
  const [whenTrueObjectives, setWhenTrueObjectives] = useState(
    initial?.whenTrueSectionConfig?.objectives?.join(', ') ?? ''
  );

  const [whenFalseTitle, setWhenFalseTitle] = useState(initial?.whenFalseSectionConfig?.title ?? '');
  const [whenFalseRequirements, setWhenFalseRequirements] = useState(
    initial?.whenFalseSectionConfig?.requirements?.join(', ') ?? ''
  );
  const [whenFalseObjectives, setWhenFalseObjectives] = useState(
    initial?.whenFalseSectionConfig?.objectives?.join(', ') ?? ''
  );

  // Collapse state for branch sections
  const [passExpanded, setPassExpanded] = useState(true);
  const [failExpanded, setFailExpanded] = useState(true);

  // Preserve nested blocks when editing (but don't display them in the form)
  const whenTrueBlocks = useRef<JsonBlock[]>(initial?.whenTrue ?? []);
  const whenFalseBlocks = useRef<JsonBlock[]>(initial?.whenFalse ?? []);

  // Build the conditional block from current form state
  const buildBlock = useCallback((): JsonConditionalBlock => {
    // Helper to parse comma-separated string to array
    const parseArray = (str: string): string[] =>
      str
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

    // Helper to build section config from state
    const buildSectionConfig = (
      title: string,
      requirements: string,
      objectives: string
    ): ConditionalSectionConfig | undefined => {
      const config: ConditionalSectionConfig = {};
      if (title.trim()) {
        config.title = title.trim();
      }
      const reqArray = parseArray(requirements);
      if (reqArray.length > 0) {
        config.requirements = reqArray;
      }
      const objArray = parseArray(objectives);
      if (objArray.length > 0) {
        config.objectives = objArray;
      }
      // Only return config if it has any properties
      return Object.keys(config).length > 0 ? config : undefined;
    };

    const conditionsArray = parseArray(conditions);

    const block: JsonConditionalBlock = {
      type: 'conditional',
      conditions: conditionsArray,
      whenTrue: whenTrueBlocks.current,
      whenFalse: whenFalseBlocks.current,
    };

    // Add optional fields
    if (description.trim()) {
      block.description = description.trim();
    }
    if (displayMode !== 'inline') {
      block.display = displayMode;
    }
    if (displayMode === 'section') {
      const trueSectionConfig = buildSectionConfig(whenTrueTitle, whenTrueRequirements, whenTrueObjectives);
      if (trueSectionConfig) {
        block.whenTrueSectionConfig = trueSectionConfig;
      }
      const falseSectionConfig = buildSectionConfig(whenFalseTitle, whenFalseRequirements, whenFalseObjectives);
      if (falseSectionConfig) {
        block.whenFalseSectionConfig = falseSectionConfig;
      }
    }

    return block;
  }, [
    conditions,
    description,
    displayMode,
    whenTrueTitle,
    whenTrueRequirements,
    whenTrueObjectives,
    whenFalseTitle,
    whenFalseRequirements,
    whenFalseObjectives,
  ]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      onSubmit(buildBlock());
    },
    [buildBlock, onSubmit]
  );

  const handleConditionClick = useCallback((condition: string) => {
    setConditions((prev) => {
      if (prev.includes(condition)) {
        return prev;
      }
      return prev ? `${prev}, ${condition}` : condition;
    });
  }, []);

  // Parse conditions to check validity
  const conditionsArray = parseArray(conditions);
  const isValid = conditionsArray.length > 0;

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <Alert title="Conditional blocks" severity="info">
        Conditional blocks show different content based on whether conditions pass or fail. Add blocks to each branch by
        dragging them into the &quot;When conditions pass&quot; or &quot;When conditions fail&quot; areas in the main
        editor.
      </Alert>

      {/* Conditions */}
      <Field
        label="Conditions"
        description="Conditions that determine which branch to show (comma-separated). All conditions must pass to show the 'true' branch."
        required
      >
        <TextArea
          value={conditions}
          onChange={(e) => setConditions(e.currentTarget.value)}
          placeholder="e.g., has-datasource:prometheus, on-page:/connections"
          rows={2}
          autoFocus
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
              onClick={() => handleConditionClick(req)}
            />
          ))}
        </div>
      </div>

      {/* Description (optional, for authors only) */}
      <Field label="Description" description="Optional note for authors (not shown to users)">
        <Input
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          placeholder="e.g., Check if user has Prometheus installed"
        />
      </Field>

      {/* Display mode */}
      <Field label="Display mode" description="Choose how the conditional content is displayed to users">
        <RadioButtonGroup
          options={DISPLAY_MODE_OPTIONS}
          value={displayMode}
          onChange={(value) => setDisplayMode(value)}
        />
      </Field>

      {/* Per-branch section configuration (only shown when display mode is 'section') */}
      {displayMode === 'section' && (
        <>
          {/* Pass branch configuration */}
          <div className={`${branchStyles.branchSection} ${branchStyles.passSection}`}>
            <div
              className={branchStyles.branchHeader}
              onClick={() => setPassExpanded(!passExpanded)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setPassExpanded(!passExpanded)}
            >
              <span className={`${branchStyles.branchIcon} ${passExpanded ? branchStyles.branchIconExpanded : ''}`}>
                ▶
              </span>
              <span className={branchStyles.branchTitle}>✓ When conditions pass</span>
            </div>
            {passExpanded && (
              <div className={branchStyles.branchContent}>
                <Field label="Section title" description="Title shown for this section">
                  <Input
                    value={whenTrueTitle}
                    onChange={(e) => setWhenTrueTitle(e.currentTarget.value)}
                    placeholder="e.g., Configure Prometheus"
                  />
                </Field>
                <Field label="Requirements" description="Prerequisites for this section (comma-separated)">
                  <TextArea
                    value={whenTrueRequirements}
                    onChange={(e) => setWhenTrueRequirements(e.currentTarget.value)}
                    placeholder="e.g., on-page:/datasources/prometheus"
                    rows={2}
                  />
                </Field>
                <Field label="Objectives" description="Completion goals for this section (comma-separated)">
                  <TextArea
                    value={whenTrueObjectives}
                    onChange={(e) => setWhenTrueObjectives(e.currentTarget.value)}
                    placeholder="e.g., prometheus-configured"
                    rows={2}
                  />
                </Field>
              </div>
            )}
          </div>

          {/* Fail branch configuration */}
          <div className={`${branchStyles.branchSection} ${branchStyles.failSection}`}>
            <div
              className={branchStyles.branchHeader}
              onClick={() => setFailExpanded(!failExpanded)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setFailExpanded(!failExpanded)}
            >
              <span className={`${branchStyles.branchIcon} ${failExpanded ? branchStyles.branchIconExpanded : ''}`}>
                ▶
              </span>
              <span className={branchStyles.branchTitle}>✗ When conditions fail</span>
            </div>
            {failExpanded && (
              <div className={branchStyles.branchContent}>
                <Field label="Section title" description="Title shown for this section">
                  <Input
                    value={whenFalseTitle}
                    onChange={(e) => setWhenFalseTitle(e.currentTarget.value)}
                    placeholder="e.g., Install Prometheus"
                  />
                </Field>
                <Field label="Requirements" description="Prerequisites for this section (comma-separated)">
                  <TextArea
                    value={whenFalseRequirements}
                    onChange={(e) => setWhenFalseRequirements(e.currentTarget.value)}
                    placeholder="e.g., on-page:/connections"
                    rows={2}
                  />
                </Field>
                <Field label="Objectives" description="Completion goals for this section (comma-separated)">
                  <TextArea
                    value={whenFalseObjectives}
                    onChange={(e) => setWhenFalseObjectives(e.currentTarget.value)}
                    placeholder="e.g., has-datasource:prometheus"
                    rows={2}
                  />
                </Field>
              </div>
            )}
          </div>
        </>
      )}

      {/* Preview of conditions */}
      {conditionsArray.length > 0 && (
        <div className={styles.previewSection}>
          <span className={styles.previewLabel}>Conditions to evaluate:</span>
          <ul className={styles.previewList}>
            {conditionsArray.map((condition, idx) => (
              <li key={idx}>{condition}</li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.footer}>
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
ConditionalBlockForm.displayName = 'ConditionalBlockForm';
