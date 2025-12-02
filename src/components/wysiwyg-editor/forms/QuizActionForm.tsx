import React, { useState, useCallback } from 'react';
import { css } from '@emotion/css';
import { Field, Input, Button, Stack, Checkbox, Select, useStyles2, IconButton, Alert } from '@grafana/ui';
import { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { type InteractiveFormProps } from '../types';
import {
  DATA_ATTRIBUTES,
  ACTION_TYPES,
  DEFAULT_VALUES,
  COMMON_REQUIREMENTS,
} from '../../../constants/interactive-config';
import { getActionConfig } from './actionConfig';
import { InteractiveFormShell } from './InteractiveFormShell';

interface QuizChoice {
  id: string;
  text: string;
  correct: boolean;
  hint?: string;
}

const getStyles = (theme: GrafanaTheme2) => ({
  choicesList: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
  }),
  choiceItem: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    padding: theme.spacing(1.5),
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  choiceHeader: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  choiceNumber: css({
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
  choiceInputs: css({
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
  }),
  choiceRow: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  choiceTextInput: css({
    flex: 1,
  }),
  correctCheckbox: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
    backgroundColor: theme.colors.background.primary,
    borderRadius: theme.shape.radius.default,
    whiteSpace: 'nowrap',
  }),
  hintInput: css({
    marginTop: theme.spacing(0.5),
  }),
  addButton: css({
    marginTop: theme.spacing(1),
  }),
  optionsGrid: css({
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: theme.spacing(2),
  }),
  requirementsButtons: css({
    marginTop: theme.spacing(0.5),
    display: 'flex',
    gap: theme.spacing(0.5),
    flexWrap: 'wrap',
  }),
  sectionTitle: css({
    fontSize: theme.typography.h5.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    marginTop: theme.spacing(2),
    marginBottom: theme.spacing(1),
  }),
  emptyState: css({
    padding: theme.spacing(2),
    textAlign: 'center',
    color: theme.colors.text.secondary,
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px dashed ${theme.colors.border.weak}`,
  }),
});

const COMPLETION_MODE_OPTIONS: Array<SelectableValue<string>> = [
  { label: 'Correct only', value: 'correct-only', description: 'User must answer correctly' },
  { label: 'Max attempts', value: 'max-attempts', description: 'Reveal after max attempts' },
];

/**
 * Custom form component for Quiz actions
 * Allows creating questions with multiple choice answers
 */
const QuizActionForm = ({ onApply, onCancel, initialValues, onSwitchType }: InteractiveFormProps) => {
  const styles = useStyles2(getStyles);
  const config = getActionConfig(ACTION_TYPES.QUIZ);

  if (!config) {
    throw new Error(`Action config not found for ${ACTION_TYPES.QUIZ}`);
  }

  // Cast to any for quiz-specific properties (these are internal, not in the type)
  const initialData = initialValues as Record<string, unknown> | undefined;

  // Parse initial choices if editing
  const parseInitialChoices = (): QuizChoice[] => {
    if (initialData?.__quizChoices) {
      return initialData.__quizChoices as QuizChoice[];
    }
    // Default with 2 empty choices
    return [
      { id: 'choice-1', text: '', correct: false },
      { id: 'choice-2', text: '', correct: false },
    ];
  };

  // State
  const [question, setQuestion] = useState<string>((initialData?.__quizQuestion as string) || '');
  const [choices, setChoices] = useState<QuizChoice[]>(parseInitialChoices);
  const [multiSelect, setMultiSelect] = useState<boolean>((initialData?.__quizMultiSelect as boolean) ?? false);
  const [completionMode, setCompletionMode] = useState<string>(
    (initialData?.__quizCompletionMode as string) || 'correct-only'
  );
  const [maxAttempts, setMaxAttempts] = useState<number>((initialData?.__quizMaxAttempts as number) ?? 3);
  const [requirements, setRequirements] = useState<string>(
    (initialData?.[DATA_ATTRIBUTES.REQUIREMENTS] as string) || ''
  );
  const [skippable, setSkippable] = useState<boolean>((initialData?.__quizSkippable as boolean) ?? false);

  // Generate unique ID for new choice
  const generateChoiceId = () => `choice-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  // Add new choice
  const handleAddChoice = useCallback(() => {
    setChoices((prev) => [...prev, { id: generateChoiceId(), text: '', correct: false }]);
  }, []);

  // Remove choice
  const handleRemoveChoice = useCallback((id: string) => {
    setChoices((prev) => prev.filter((c) => c.id !== id));
  }, []);

  // Update choice
  const handleUpdateChoice = useCallback((id: string, field: keyof QuizChoice, value: string | boolean) => {
    setChoices((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
  }, []);

  // Validation
  const isValid = (): boolean => {
    if (!question.trim()) {
      return false;
    }
    // Need at least 2 choices with text
    const validChoices = choices.filter((c) => c.text.trim());
    if (validChoices.length < 2) {
      return false;
    }
    // Need at least one correct answer
    const hasCorrect = choices.some((c) => c.correct && c.text.trim());
    return hasCorrect;
  };

  // Get validation message
  const getValidationMessage = (): string | null => {
    if (!question.trim()) {
      return 'Enter a question';
    }
    const validChoices = choices.filter((c) => c.text.trim());
    if (validChoices.length < 2) {
      return 'Add at least 2 choices';
    }
    const hasCorrect = choices.some((c) => c.correct && c.text.trim());
    if (!hasCorrect) {
      return 'Mark at least one choice as correct';
    }
    return null;
  };

  const handleApply = () => {
    if (!isValid()) {
      return;
    }

    // Filter out empty choices and build final choices array
    const finalChoices = choices
      .filter((c) => c.text.trim())
      .map((c) => ({
        id: c.id,
        text: c.text.trim(),
        correct: c.correct,
        hint: c.hint?.trim() || undefined,
      }));

    // Build attributes with quiz data as internal properties
    const attributes: Record<string, unknown> = {
      [DATA_ATTRIBUTES.TARGET_ACTION]: ACTION_TYPES.QUIZ,
      [DATA_ATTRIBUTES.REQUIREMENTS]: requirements || undefined,
      class: DEFAULT_VALUES.CLASS,
      // Store quiz-specific data as internal properties (will be extracted during insertion)
      __quizQuestion: question.trim(),
      __quizChoices: finalChoices,
      __quizMultiSelect: multiSelect,
      __quizCompletionMode: completionMode,
      __quizMaxAttempts: maxAttempts,
      __quizSkippable: skippable,
    };

    onApply(attributes as Record<string, string>);
  };

  const validationMessage = getValidationMessage();

  return (
    <InteractiveFormShell
      title={config.title}
      description={config.description}
      infoBox="Create a quiz question with multiple choice answers. Users must select the correct answer(s) to complete this step."
      onCancel={onCancel}
      onSwitchType={onSwitchType}
      initialValues={initialValues}
      isValid={isValid()}
      onApply={handleApply}
    >
      <Stack direction="column" gap={2}>
        {/* Question */}
        <Field label="Question:" required>
          <Input
            value={question}
            onChange={(e) => setQuestion(e.currentTarget.value)}
            placeholder="What is the main purpose of Grafana dashboards?"
            autoFocus
          />
        </Field>

        {/* Choices */}
        <div>
          <h5 className={styles.sectionTitle}>Choices</h5>
          <div className={styles.choicesList}>
            {choices.length === 0 ? (
              <div className={styles.emptyState}>No choices added yet</div>
            ) : (
              choices.map((choice, index) => (
                <div key={choice.id} className={styles.choiceItem}>
                  <div className={styles.choiceHeader}>
                    <span className={styles.choiceNumber}>{index + 1}</span>
                    <div className={styles.choiceInputs}>
                      <div className={styles.choiceRow}>
                        <Input
                          className={styles.choiceTextInput}
                          value={choice.text}
                          onChange={(e) => handleUpdateChoice(choice.id, 'text', e.currentTarget.value)}
                          placeholder="Enter choice text..."
                        />
                        <div className={styles.correctCheckbox}>
                          <Checkbox
                            value={choice.correct}
                            onChange={(e) => handleUpdateChoice(choice.id, 'correct', e.currentTarget.checked)}
                          />
                          <span>Correct</span>
                        </div>
                        <IconButton
                          name="trash-alt"
                          aria-label="Remove choice"
                          onClick={() => handleRemoveChoice(choice.id)}
                          tooltip="Remove choice"
                          variant="destructive"
                        />
                      </div>
                      <Input
                        className={styles.hintInput}
                        value={choice.hint || ''}
                        onChange={(e) => handleUpdateChoice(choice.id, 'hint', e.currentTarget.value)}
                        placeholder="Hint if user selects this wrong answer (optional)"
                      />
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          <Button variant="secondary" size="sm" icon="plus" onClick={handleAddChoice} className={styles.addButton}>
            Add Choice
          </Button>
        </div>

        {/* Quiz Options */}
        <div>
          <h5 className={styles.sectionTitle}>Options</h5>
          <div className={styles.optionsGrid}>
            <Field label="Completion Mode:">
              <Select
                options={COMPLETION_MODE_OPTIONS}
                value={COMPLETION_MODE_OPTIONS.find((opt) => opt.value === completionMode)}
                onChange={(opt) => setCompletionMode(opt?.value || 'correct-only')}
              />
            </Field>
            {completionMode === 'max-attempts' && (
              <Field label="Max Attempts:">
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={maxAttempts}
                  onChange={(e) => setMaxAttempts(parseInt(e.currentTarget.value, 10) || 3)}
                />
              </Field>
            )}
          </div>
          <Stack direction="row" gap={2}>
            <Checkbox
              label="Allow multiple correct answers"
              value={multiSelect}
              onChange={(e) => setMultiSelect(e.currentTarget.checked)}
            />
            <Checkbox label="Skippable" value={skippable} onChange={(e) => setSkippable(e.currentTarget.checked)} />
          </Stack>
        </div>

        {/* Requirements */}
        <Field label="Requirements:" description="Optional prerequisites for this quiz">
          <Stack direction="column" gap={0.5}>
            <Input
              value={requirements}
              onChange={(e) => setRequirements(e.currentTarget.value)}
              placeholder="e.g., on-page:/dashboards"
            />
            <div className={styles.requirementsButtons}>
              {COMMON_REQUIREMENTS.filter((req) => req !== 'exists-reftarget')
                .slice(0, 3)
                .map((req) => (
                  <Button key={req} size="sm" variant="secondary" onClick={() => setRequirements(req)}>
                    {req}
                  </Button>
                ))}
            </div>
          </Stack>
        </Field>

        {/* Validation feedback */}
        {validationMessage && (
          <Alert severity="info" title="Before you can apply:">
            {validationMessage}
          </Alert>
        )}
      </Stack>
    </InteractiveFormShell>
  );
};

export default QuizActionForm;
