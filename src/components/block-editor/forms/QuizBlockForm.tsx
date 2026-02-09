/**
 * Quiz Block Form
 *
 * Form for creating/editing quiz blocks with single or multiple choice questions.
 * Supports configurable completion modes, hints for wrong answers, and requirements.
 */

import React, { useState, useCallback } from 'react';
import {
  Button,
  Field,
  Input,
  TextArea,
  Checkbox,
  Badge,
  useStyles2,
  IconButton,
  RadioButtonGroup,
  Combobox,
  Alert,
  type ComboboxOption,
} from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { getBlockFormStyles } from '../block-editor.styles';
import { COMMON_REQUIREMENTS } from '../../../constants/interactive-config';
import { TypeSwitchDropdown } from './TypeSwitchDropdown';
import type { BlockFormProps, JsonBlock } from '../types';
import type { JsonQuizBlock, JsonQuizChoice } from '../../../types/json-guide.types';

/**
 * Type guard for quiz blocks
 */
function isQuizBlock(block: JsonBlock): block is JsonQuizBlock {
  return block.type === 'quiz';
}

/** Completion mode options */
const COMPLETION_MODE_OPTIONS: Array<ComboboxOption<'correct-only' | 'max-attempts'>> = [
  {
    value: 'correct-only',
    label: 'Correct only',
    description: 'User must answer correctly to complete',
  },
  {
    value: 'max-attempts',
    label: 'Max attempts',
    description: 'Reveal answer after X wrong attempts',
  },
];

/** Max attempts options for dropdown */
const MAX_ATTEMPTS_OPTIONS: Array<ComboboxOption<number>> = [
  { value: 1, label: '1 attempt' },
  { value: 2, label: '2 attempts' },
  { value: 3, label: '3 attempts (default)' },
  { value: 5, label: '5 attempts' },
  { value: 10, label: '10 attempts' },
];

/** Generate a unique choice ID */
function generateChoiceId(existingIds: string[]): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  for (const letter of letters) {
    if (!existingIds.includes(letter)) {
      return letter;
    }
  }
  // Fallback to numbered IDs if all letters are used
  let num = 1;
  while (existingIds.includes(`choice-${num}`)) {
    num++;
  }
  return `choice-${num}`;
}

/** Styles specific to quiz form */
const getQuizFormStyles = (theme: GrafanaTheme2) => ({
  choiceList: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
  }),
  choiceItem: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    padding: theme.spacing(1.5),
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    backgroundColor: theme.colors.background.secondary,
    transition: 'all 0.15s ease',

    '&:hover': {
      borderColor: theme.colors.border.medium,
    },
  }),
  choiceItemCorrect: css({
    borderColor: theme.colors.success.border,
    backgroundColor: theme.colors.success.transparent,
  }),
  choiceHeader: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  choiceIdBadge: css({
    minWidth: '28px',
    textAlign: 'center',
    fontWeight: theme.typography.fontWeightBold,
    textTransform: 'uppercase',
  }),
  choiceTextInput: css({
    flex: 1,
  }),
  choiceActions: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    marginLeft: 'auto',
  }),
  choiceHintRow: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginLeft: theme.spacing(4.5), // Align with text input
  }),
  choiceHintLabel: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    whiteSpace: 'nowrap',
  }),
  addChoiceButton: css({
    alignSelf: 'flex-start',
  }),
  modeSection: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
    padding: theme.spacing(1.5),
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  modeRow: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(2),
    flexWrap: 'wrap',
  }),
  validationError: css({
    color: theme.colors.error.text,
    fontSize: theme.typography.bodySmall.fontSize,
    marginTop: theme.spacing(0.5),
  }),
});

/**
 * Quiz block form component
 */
export function QuizBlockForm({
  initialData,
  onSubmit,
  onCancel,
  isEditing = false,
  onSwitchBlockType,
}: BlockFormProps) {
  const styles = useStyles2(getBlockFormStyles);
  const quizStyles = useStyles2(getQuizFormStyles);

  // Initialize from existing data or defaults
  const initial = initialData && isQuizBlock(initialData) ? initialData : null;

  const [question, setQuestion] = useState(initial?.question ?? '');
  const [choices, setChoices] = useState<JsonQuizChoice[]>(
    initial?.choices ?? [
      { id: 'a', text: '', correct: true },
      { id: 'b', text: '' },
    ]
  );
  const [multiSelect, setMultiSelect] = useState(initial?.multiSelect ?? false);
  const [completionMode, setCompletionMode] = useState<'correct-only' | 'max-attempts'>(
    initial?.completionMode ?? 'correct-only'
  );
  const [maxAttempts, setMaxAttempts] = useState(initial?.maxAttempts ?? 3);
  const [requirements, setRequirements] = useState(initial?.requirements?.join(', ') ?? '');
  const [skippable, setSkippable] = useState(initial?.skippable ?? false);

  // Add a new choice
  const handleAddChoice = useCallback(() => {
    const existingIds = choices.map((c) => c.id);
    const newId = generateChoiceId(existingIds);
    setChoices([...choices, { id: newId, text: '' }]);
  }, [choices]);

  // Remove a choice
  const handleRemoveChoice = useCallback(
    (id: string) => {
      if (choices.length <= 2) {
        return; // Minimum 2 choices
      }
      setChoices(choices.filter((c) => c.id !== id));
    },
    [choices]
  );

  // Update choice text
  const handleChoiceTextChange = useCallback((id: string, text: string) => {
    setChoices((prev) => prev.map((c) => (c.id === id ? { ...c, text } : c)));
  }, []);

  // Update choice hint - store raw value, trim only on submit
  const handleChoiceHintChange = useCallback((id: string, hint: string) => {
    setChoices((prev) => prev.map((c) => (c.id === id ? { ...c, hint } : c)));
  }, []);

  // Toggle correct answer (single select mode)
  const handleSetCorrectSingle = useCallback((id: string) => {
    setChoices((prev) =>
      prev.map((c) => ({
        ...c,
        correct: c.id === id ? true : undefined,
      }))
    );
  }, []);

  // Toggle correct answer (multi select mode)
  const handleToggleCorrectMulti = useCallback((id: string) => {
    setChoices((prev) =>
      prev.map((c) => {
        if (c.id !== id) {
          return c;
        }
        return { ...c, correct: c.correct ? undefined : true };
      })
    );
  }, []);

  // Handle multiSelect toggle - ensure at least one correct answer
  const handleMultiSelectChange = useCallback(
    (checked: boolean) => {
      setMultiSelect(checked);
      // If switching to single select and multiple are marked correct,
      // keep only the first correct one
      if (!checked) {
        const correctChoices = choices.filter((c) => c.correct);
        if (correctChoices.length > 1) {
          const firstCorrectId = correctChoices[0].id;
          setChoices((prev) =>
            prev.map((c) => ({
              ...c,
              correct: c.id === firstCorrectId ? true : undefined,
            }))
          );
        }
      }
    },
    [choices]
  );

  // Handle requirement quick-add
  const handleRequirementClick = useCallback((req: string) => {
    setRequirements((prev) => {
      if (prev.includes(req)) {
        return prev;
      }
      return prev ? `${prev}, ${req}` : req;
    });
  }, []);

  // Form submission
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      // Parse requirements
      const reqArray = requirements
        .split(',')
        .map((r) => r.trim())
        .filter((r) => r.length > 0);

      // Clean up choices - remove empty hint fields
      const cleanedChoices: JsonQuizChoice[] = choices.map((c) => {
        const cleaned: JsonQuizChoice = {
          id: c.id,
          text: c.text.trim(),
        };
        if (c.correct) {
          cleaned.correct = true;
        }
        if (c.hint?.trim()) {
          cleaned.hint = c.hint.trim();
        }
        return cleaned;
      });

      const block: JsonQuizBlock = {
        type: 'quiz',
        question: question.trim(),
        choices: cleanedChoices,
        ...(multiSelect && { multiSelect }),
        ...(completionMode !== 'correct-only' && { completionMode }),
        ...(completionMode === 'max-attempts' && maxAttempts !== 3 && { maxAttempts }),
        ...(reqArray.length > 0 && { requirements: reqArray }),
        ...(skippable && { skippable }),
      };

      onSubmit(block);
    },
    [question, choices, multiSelect, completionMode, maxAttempts, requirements, skippable, onSubmit]
  );

  // Validation
  const hasQuestion = question.trim().length > 0;
  const hasValidChoices = choices.length >= 2 && choices.every((c) => c.text.trim().length > 0);
  const hasCorrectAnswer = choices.some((c) => c.correct);
  const isValid = hasQuestion && hasValidChoices && hasCorrectAnswer;


  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <Alert title="Quiz block" severity="info">
        Create knowledge assessment questions with single or multiple correct answers. Users can test their
        understanding before proceeding.
      </Alert>

      {/* Question */}
      <Field label="Question" description="The question text (supports markdown formatting)" required>
        <TextArea
          value={question}
          onChange={(e) => setQuestion(e.currentTarget.value)}
          rows={3}
          placeholder="What is the default port for Grafana?"
        />
      </Field>

      {/* Question Type */}
      <Field label="Answer type" description="Single choice uses radio buttons, multiple choice uses checkboxes">
        <div className={quizStyles.modeRow}>
          <RadioButtonGroup
            options={[
              { label: 'Single choice', value: false },
              { label: 'Multiple choice', value: true },
            ]}
            value={multiSelect}
            onChange={handleMultiSelectChange}
          />
        </div>
      </Field>

      {/* Choices */}
      <Field
        label="Answer choices"
        description={multiSelect ? 'Check all correct answers' : 'Select the correct answer'}
        required
      >
        <div className={quizStyles.choiceList}>
          {choices.map((choice, index) => (
            <div
              key={choice.id}
              className={`${quizStyles.choiceItem} ${choice.correct ? quizStyles.choiceItemCorrect : ''}`}
            >
              <div className={quizStyles.choiceHeader}>
                {/* Correct answer indicator/toggle */}
                {multiSelect ? (
                  <Checkbox
                    value={choice.correct ?? false}
                    onChange={() => handleToggleCorrectMulti(choice.id)}
                    aria-label={`Mark choice ${choice.id} as correct`}
                  />
                ) : (
                  <input
                    type="radio"
                    name="correct-answer"
                    checked={choice.correct ?? false}
                    onChange={() => handleSetCorrectSingle(choice.id)}
                    aria-label={`Mark choice ${choice.id} as correct`}
                  />
                )}

                {/* Choice ID badge */}
                <Badge text={choice.id.toUpperCase()} color={choice.correct ? 'green' : 'blue'} />

                {/* Choice text */}
                <Input
                  value={choice.text}
                  onChange={(e) => handleChoiceTextChange(choice.id, e.currentTarget.value)}
                  placeholder={`Answer option ${index + 1}`}
                  className={quizStyles.choiceTextInput}
                />

                {/* Actions */}
                <div className={quizStyles.choiceActions}>
                  <IconButton
                    name="trash-alt"
                    tooltip="Remove choice"
                    onClick={() => handleRemoveChoice(choice.id)}
                    disabled={choices.length <= 2}
                    aria-label={`Remove choice ${choice.id}`}
                    size="md"
                  />
                </div>
              </div>

              {/* Hint for wrong answer */}
              {!choice.correct && (
                <div className={quizStyles.choiceHintRow}>
                  <span className={quizStyles.choiceHintLabel}>Hint if selected:</span>
                  <Input
                    value={choice.hint ?? ''}
                    onChange={(e) => handleChoiceHintChange(choice.id, e.currentTarget.value)}
                    placeholder="Optional hint shown when this wrong answer is selected"
                  />
                </div>
              )}
            </div>
          ))}

          <Button
            variant="secondary"
            icon="plus"
            onClick={handleAddChoice}
            type="button"
            className={quizStyles.addChoiceButton}
          >
            Add choice
          </Button>
        </div>
      </Field>

      {/* Validation messages */}
      {!hasCorrectAnswer && choices.length > 0 && (
        <div className={quizStyles.validationError}>⚠️ Please mark at least one correct answer</div>
      )}

      {/* Completion Mode */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Completion settings</div>
        <div className={quizStyles.modeSection}>
          <Field label="Completion mode" description="How the quiz is marked complete">
            <Combobox
              options={COMPLETION_MODE_OPTIONS}
              value={completionMode}
              onChange={(option) => setCompletionMode(option.value)}
            />
          </Field>

          {completionMode === 'max-attempts' && (
            <Field label="Maximum attempts" description="Reveal correct answer after this many wrong attempts">
              <Combobox
                options={MAX_ATTEMPTS_OPTIONS}
                value={maxAttempts}
                onChange={(option) => setMaxAttempts(option.value)}
              />
            </Field>
          )}
        </div>
      </div>

      {/* Advanced Options */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Advanced options</div>
        <Checkbox
          className={styles.checkbox}
          label="Skippable (user can skip this quiz)"
          checked={skippable}
          onChange={(e) => setSkippable(e.currentTarget.checked)}
        />
      </div>

      {/* Requirements */}
      <Field label="Requirements" description="Conditions that must be met before showing this quiz (comma-separated)">
        <Input
          value={requirements}
          onChange={(e) => setRequirements(e.currentTarget.value)}
          placeholder="e.g., on-page:/dashboards, datasource-exists:prometheus"
        />
      </Field>
      <div className={styles.requirementsContainer}>
        <span className={styles.requirementsLabel}>Quick add:</span>
        <div className={styles.requirementsChips}>
          {COMMON_REQUIREMENTS.slice(0, 6).map((req) => (
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

      <div className={styles.footer}>
        {isEditing && onSwitchBlockType && (
          <div className={styles.footerLeft}>
            <TypeSwitchDropdown currentType="quiz" onSwitch={onSwitchBlockType} blockData={initialData} />
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
QuizBlockForm.displayName = 'QuizBlockForm';
