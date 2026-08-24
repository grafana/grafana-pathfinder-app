import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { css, cx, keyframes } from '@emotion/css';
import { Button, Icon, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';

import { useStepChecker } from '../../requirements-manager';
import { reportAppInteraction, UserInteraction, buildInteractiveStepProperties } from '../../lib/analytics';
import { testIds } from '../../constants/testIds';
import { markStepCompleted, resetStep, useStepCompletion } from '../../global-state/completion-store';
import type { ProgressReason } from '../../global-state/progress-events';

// ============ Types ============

export interface QuizChoice {
  id: string;
  text: string;
  correct: boolean;
  hint?: string;
  /** When the quiz is shuffled, keep this choice at its authored index. */
  pinned?: boolean;
}

export interface InteractiveQuizProps {
  /** Question text (rendered from children) */
  question: string;
  /** Available choices */
  choices: QuizChoice[];
  /** Multi-select mode (checkboxes) vs single-select (radio) */
  multiSelect?: boolean;
  /** Completion mode */
  completionMode?: 'correct-only' | 'max-attempts';
  /** Max attempts for max-attempts mode */
  maxAttempts?: number;
  /** Requirements for this quiz */
  requirements?: string;
  /** Whether quiz can be skipped */
  skippable?: boolean;
  /**
   * Randomize choice display order (default: true). Choices with
   * `pinned: true` keep their authored index even when shuffling.
   */
  shuffle?: boolean;
  /** Rendered children (question content) */
  children?: React.ReactNode;

  // Section integration props
  stepId?: string;
  isEligibleForChecking?: boolean;
  onStepComplete?: (stepId: string) => void;
  disabled?: boolean;
  resetTrigger?: number;

  // Document-wide step position (passed from section)
  stepIndex?: number;
  totalSteps?: number;
  sectionId?: string;
  sectionTitle?: string;
}

// ============ Component ============

// Thresholds for the compact side-by-side pill layout — short questions
// (True/False, single-word choices) read better as pills; anything longer
// or more numerous falls back to the stacked full-width rows.
const PILL_LAYOUT_MAX_CHOICES = 4;
const PILL_LAYOUT_MAX_CHOICE_LENGTH = 20;

// Counter for generating unique quiz IDs
let quizCounter = 0;

/** Reset the anonymous quiz counter (called by resetInteractiveCounters). */
export function resetQuizCounter(): void {
  quizCounter = 0;
}

/**
 * Shuffle quiz choices while keeping any choice with `pinned: true` at its
 * authored index. Non-pinned choices are Fisher–Yates shuffled into the
 * remaining slots. `rng` defaults to `Math.random` and is overridable so
 * tests can produce a deterministic order.
 */
export function shuffleQuizChoices(choices: QuizChoice[], rng: () => number = Math.random): QuizChoice[] {
  if (choices.length <= 1) {
    return choices.slice();
  }

  // Reserve pinned slots at their authored positions.
  const result: Array<QuizChoice | undefined> = new Array(choices.length).fill(undefined);
  const unpinned: QuizChoice[] = [];
  for (let i = 0; i < choices.length; i++) {
    const choice = choices[i]!;
    if (choice.pinned) {
      result[i] = choice;
    } else {
      unpinned.push(choice);
    }
  }

  // Fisher–Yates on the non-pinned subset.
  for (let i = unpinned.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = unpinned[i]!;
    unpinned[i] = unpinned[j]!;
    unpinned[j] = tmp;
  }

  // Fill empty slots in order with the shuffled non-pinned choices.
  let cursor = 0;
  for (let i = 0; i < result.length; i++) {
    if (result[i] === undefined) {
      result[i] = unpinned[cursor++];
    }
  }
  return result as QuizChoice[];
}

export const InteractiveQuiz: React.FC<InteractiveQuizProps> = ({
  question,
  choices,
  multiSelect = false,
  completionMode = 'correct-only',
  maxAttempts = 3,
  requirements,
  skippable = false,
  shuffle = true,
  children,
  stepId: providedStepId,
  isEligibleForChecking = true,
  onStepComplete,
  disabled = false,
  resetTrigger,
  stepIndex,
  totalSteps,
  sectionId,
  sectionTitle,
}) => {
  const styles = useStyles2(getQuizStyles);

  // Generate stable step ID using useState lazy initialization (runs once on mount)
  const [generatedStepId] = useState(() => {
    quizCounter += 1;
    return `quiz-${quizCounter}`;
  });
  const stepId = providedStepId ?? generatedStepId;

  // State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [attempts, setAttempts] = useState(0);

  // Completion lives in the store. Standalone quizzes (no `onStepComplete`)
  // write directly; section-managed quizzes notify the section, which
  // writes through its own persist effect.
  const { completed: storedCompleted } = useStepCompletion(stepId, sectionId);
  const isStandalone = !onStepComplete;
  // `reason` flows into the `pathfinder:progress` event so downstream
  // consumers can distinguish a correct-answer completion (`'manual'`)
  // from a user-initiated skip (`'skipped'`). The checker's own skip
  // bridge writes `'skipped'` first; without this reason plumbing the
  // standalone store write here would silently overwrite it with
  // `'manual'`, making the event lie about intent.
  const persistCompletion = useCallback(
    (reason: ProgressReason = 'manual') => {
      if (isStandalone) {
        markStepCompleted(stepId, sectionId, reason);
      }
    },
    [isStandalone, stepId, sectionId]
  );
  const persistReset = useCallback(() => {
    if (isStandalone) {
      resetStep(stepId, sectionId);
    }
  }, [isStandalone, stepId, sectionId]);
  const [lastResult, setLastResult] = useState<'none' | 'correct' | 'incorrect'>('none');
  const [showHint, setShowHint] = useState<string | null>(null);
  const [isRevealed, setIsRevealed] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  // Display order. Computed ONCE on mount via lazy init so a parent re-render
  // cannot reorder choices mid-quiz. Re-shuffled only when the parent triggers
  // a reset (see effect below). Selection, completion, hints, analytics, and
  // test IDs are all id-keyed, so display-order changes never alter quiz state.
  const [displayChoices, setDisplayChoices] = useState<QuizChoice[]>(() =>
    shuffle ? shuffleQuizChoices(choices) : choices
  );

  // Requirements checking
  const {
    isEnabled,
    isCompleted: stepCompleted,
    explanation,
    canSkip,
    markSkipped,
    resetStep: checkerResetStep,
  } = useStepChecker({
    requirements,
    stepId,
    isEligibleForChecking,
    skippable,
    sectionId, // Lets the checker write skip transitions to the store
  });

  // Handle reset trigger from parent section.
  /* eslint-disable react-hooks/set-state-in-effect -- Intentional: reset quiz state when the parent section increments resetTrigger */
  useEffect(() => {
    if (resetTrigger && resetTrigger > 0) {
      setSelectedIds(new Set());
      setAttempts(0);
      persistReset();
      setLastResult('none');
      setShowHint(null);
      setIsRevealed(false);
      // Re-shuffle on retry so the user can't lean on remembered positions.
      setDisplayChoices(shuffle ? shuffleQuizChoices(choices) : choices);
      // Section already wrote the store via `resetSteps(tailStepIds)`;
      // suppress the per-child store write so the broadcast doesn't fan
      // out and wipe preceding completions (parity with interactive-step).
      if (checkerResetStep) {
        checkerResetStep({ skipStoreWrite: true });
      }
    }
  }, [resetTrigger]); // eslint-disable-line react-hooks/exhaustive-deps
  /* eslint-enable react-hooks/set-state-in-effect */

  // Compute effective completion state
  const isCompleted = storedCompleted || stepCompleted;

  // Get correct answer IDs
  const correctIds = useMemo(() => new Set(choices.filter((c) => c.correct).map((c) => c.id)), [choices]);

  // Compute displayed selection: show correct answers if quiz is completed but no selection made yet
  // This handles the case where quiz was completed in a previous session (page refresh)
  const displayedSelection = useMemo(() => {
    if (isCompleted && selectedIds.size === 0) {
      return correctIds;
    }
    return selectedIds;
  }, [isCompleted, selectedIds, correctIds]);

  // Compute displayed result for completed quizzes with no selection
  const displayedResult = useMemo(() => {
    if (isCompleted && selectedIds.size === 0) {
      return 'correct' as const;
    }
    return lastResult;
  }, [isCompleted, selectedIds.size, lastResult]);

  // Check if current selection is correct
  const checkAnswer = useCallback((): boolean => {
    if (multiSelect) {
      // For multi-select: all correct answers selected and no incorrect
      if (selectedIds.size !== correctIds.size) {
        return false;
      }
      return Array.from(selectedIds).every((id) => correctIds.has(id));
    } else {
      // For single-select: exactly one correct answer selected
      if (selectedIds.size !== 1) {
        return false;
      }
      return correctIds.has(Array.from(selectedIds)[0]!);
    }
  }, [selectedIds, correctIds, multiSelect]);

  // Build analytics properties for quiz interactions
  const buildQuizAnalyticsProps = useCallback(
    (isCorrect: boolean, attemptCount: number, revealed = false) => {
      // Get selected answer texts (truncate if too long)
      const selectedAnswers = choices
        .filter((c) => selectedIds.has(c.id))
        .map((c) => c.text)
        .join(', ');
      const truncatedSelected = selectedAnswers.length > 200 ? selectedAnswers.slice(0, 200) + '...' : selectedAnswers;

      // Get correct answer texts (truncate if too long)
      const correctAnswers = choices
        .filter((c) => c.correct)
        .map((c) => c.text)
        .join(', ');
      const truncatedCorrect = correctAnswers.length > 200 ? correctAnswers.slice(0, 200) + '...' : correctAnswers;

      // Truncate question if too long
      const truncatedQuestion = question.length > 200 ? question.slice(0, 200) + '...' : question;

      // Quiz-specific properties
      const quizProps = {
        quiz_question: truncatedQuestion,
        quiz_selected_answer: truncatedSelected,
        quiz_correct_answer: truncatedCorrect,
        quiz_is_correct: isCorrect,
        quiz_attempts: attemptCount,
        quiz_multi_select: multiSelect,
        quiz_revealed: revealed,
        quiz_total_choices: choices.length,
        target_action: 'quiz',
        interaction_location: 'interactive_quiz',
      };

      // Build complete analytics properties with document step context
      return buildInteractiveStepProperties(quizProps, {
        stepId,
        stepIndex,
        totalSteps,
        sectionId,
        sectionTitle,
      });
    },
    [choices, selectedIds, question, stepId, multiSelect, stepIndex, totalSteps, sectionId, sectionTitle]
  );

  // Shared "was this correct" outcome handling, used by the single explicit
  // Check Answer step both quiz modes share (see `handleCheckAnswer`).
  const evaluateAndApply = useCallback(
    (isCorrect: boolean, wrongChoice: QuizChoice | undefined) => {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);

      if (isCorrect) {
        setLastResult('correct');
        persistCompletion();
        setShowHint(null);

        reportAppInteraction(UserInteraction.StepAutoCompleted, buildQuizAnalyticsProps(true, newAttempts));

        if (onStepComplete && stepId) {
          onStepComplete(stepId);
        }
      } else {
        setLastResult('incorrect');
        setShakeKey((k) => k + 1);
        setShowHint(wrongChoice?.hint ?? "That's not quite right. Try again!");

        // Check if max attempts reached (for max-attempts mode)
        if (completionMode === 'max-attempts' && newAttempts >= maxAttempts) {
          setIsRevealed(true);
          persistCompletion();

          reportAppInteraction(UserInteraction.StepAutoCompleted, buildQuizAnalyticsProps(false, newAttempts, true));

          if (onStepComplete && stepId) {
            onStepComplete(stepId);
          }
        }
      }
    },
    [attempts, persistCompletion, buildQuizAnalyticsProps, onStepComplete, stepId, completionMode, maxAttempts]
  );

  // Handle choice selection — both quiz modes only ever select/toggle here.
  // The answer isn't checked until the user clicks "Check Answer"
  // (`handleCheckAnswer`), matching every other verification-style
  // interactive block in the product (`challenge`'s "Check my work",
  // `input`'s "Run check").
  const handleChoiceClick = useCallback(
    (choiceId: string) => {
      if (isCompleted || isRevealed || !isEnabled) {
        return;
      }

      setSelectedIds((prev) => {
        const newSet = new Set(prev);
        if (multiSelect) {
          if (newSet.has(choiceId)) {
            newSet.delete(choiceId);
          } else {
            newSet.add(choiceId);
          }
        } else {
          newSet.clear();
          newSet.add(choiceId);
        }
        return newSet;
      });
      setLastResult('none');
      setShowHint(null);
    },
    [isCompleted, isRevealed, isEnabled, multiSelect]
  );

  // Handle check answer
  const handleCheckAnswer = useCallback(() => {
    if (selectedIds.size === 0) {
      return;
    }

    const isCorrect = checkAnswer();
    const wrongChoice = choices.find((c) => selectedIds.has(c.id) && !c.correct);
    evaluateAndApply(isCorrect, wrongChoice);
  }, [selectedIds, checkAnswer, choices, evaluateAndApply]);

  // Handle skip
  const handleSkip = useCallback(() => {
    if (markSkipped) {
      markSkipped();
    }
    persistCompletion('skipped');
    if (onStepComplete && stepId) {
      onStepComplete(stepId);
    }
  }, [markSkipped, onStepComplete, stepId, persistCompletion]);

  // Choice state type
  type ChoiceState = 'default' | 'selected' | 'correct' | 'incorrect' | 'revealed';

  // Get choice state for styling (uses displayedSelection/displayedResult for rendering)
  const getChoiceState = useCallback(
    (choice: QuizChoice): ChoiceState => {
      if (isRevealed && choice.correct) {
        return 'revealed';
      }
      if (isCompleted && displayedResult === 'correct' && displayedSelection.has(choice.id)) {
        return 'correct';
      }
      if (displayedResult === 'incorrect' && displayedSelection.has(choice.id) && !choice.correct) {
        return 'incorrect';
      }
      if (displayedSelection.has(choice.id)) {
        return 'selected';
      }
      return 'default';
    },
    [isRevealed, isCompleted, displayedResult, displayedSelection]
  );

  // Map choice state to style class
  const getChoiceClassName = (state: ChoiceState): string => {
    switch (state) {
      case 'selected':
        return styles.choiceSelected;
      case 'correct':
        return styles.choiceCorrect;
      case 'incorrect':
        return styles.choiceIncorrect;
      case 'revealed':
        return styles.choiceRevealed;
      default:
        return styles.choiceDefault;
    }
  };

  // Determine if we should show the blocked state
  const isBlocked = !isEnabled && !isCompleted;
  const showCheckButton = !isCompleted && !isRevealed && displayedSelection.size > 0;
  const attemptsRemaining = completionMode === 'max-attempts' ? maxAttempts - attempts : null;
  const showAttemptsRemaining = attemptsRemaining !== null && !isCompleted && !isRevealed;
  // Compact pill layout only for short single-select questions — a handful
  // of short choices (True/False, single words) reads better side-by-side;
  // longer or more numerous choices keep the stacked full-width rows. Exactly
  // 4 short choices get a 2x2 grid instead of a single row of 4 — one row
  // stays readable up to 3 pills, but a 4-wide row starts feeling cramped.
  // Multi-select always keeps the stacked layout too: pills drop the leading
  // indicator, and without the checkbox there's no visual cue that more than
  // one choice can be selected.
  const useCompactChoiceLayout =
    !multiSelect &&
    displayChoices.length <= PILL_LAYOUT_MAX_CHOICES &&
    displayChoices.every((c) => c.text.length <= PILL_LAYOUT_MAX_CHOICE_LENGTH);
  const useGridChoiceLayout = useCompactChoiceLayout && displayChoices.length === 4;

  return (
    <div
      className={cx(styles.container, {
        [styles.blocked]: isBlocked,
      })}
      data-testid={testIds.interactive.quiz(stepId)}
    >
      {/* Label header */}
      <div className={styles.header}>
        <div className={styles.headerLabel}>
          <Icon name="pen" size="sm" className={styles.headerIcon} />
          <span>Knowledge check</span>
        </div>
        {showAttemptsRemaining && (
          <span className={styles.attempts}>
            {attemptsRemaining} attempt{attemptsRemaining !== 1 ? 's' : ''} remaining
          </span>
        )}
      </div>

      {/* Question */}
      <div className={styles.questionContent}>{children}</div>

      {/* Blocked message */}
      {isBlocked && (
        <div className={styles.blockedMessage}>
          <Icon name="lock" size="sm" />
          <span>{explanation || 'Complete previous step'}</span>
        </div>
      )}

      {/* Choices */}
      <div
        className={cx(styles.choices, {
          [styles.choicesCompact]: useCompactChoiceLayout && !useGridChoiceLayout,
          [styles.choicesGrid]: useGridChoiceLayout,
          [styles.shake]: displayedResult === 'incorrect',
        })}
        key={shakeKey}
      >
        {displayChoices.map((choice) => {
          const state = getChoiceState(choice);
          const isSelected = displayedSelection.has(choice.id);

          return (
            <button
              key={choice.id}
              type="button"
              className={cx(styles.choice, getChoiceClassName(state), {
                [styles.choiceCompact]: useCompactChoiceLayout && !useGridChoiceLayout,
                [styles.choiceGridItem]: useGridChoiceLayout,
              })}
              onClick={() => handleChoiceClick(choice.id)}
              disabled={isCompleted || isRevealed || isBlocked}
              aria-pressed={isSelected}
              data-testid={testIds.interactive.quizChoice(stepId, choice.id)}
            >
              {!useCompactChoiceLayout && (
                <span className={styles.choiceIndicator}>
                  {multiSelect ? (
                    <span className={cx(styles.checkbox, { [styles.checked]: isSelected })}>
                      {isSelected && <Icon name="check" size="xs" />}
                    </span>
                  ) : (
                    <span className={cx(styles.radio, { [styles.radioSelected]: isSelected })} />
                  )}
                </span>
              )}
              <span className={styles.choiceText}>{choice.text}</span>
              {state === 'correct' && <Icon name="check-circle" className={styles.correctIcon} />}
              {state === 'revealed' && <Icon name="check-circle" className={styles.revealedIcon} />}
              {state === 'incorrect' && <Icon name="times-circle" className={styles.incorrectIcon} />}
            </button>
          );
        })}
      </div>

      {/* Hint/Feedback */}
      {showHint && !isCompleted && (
        <div className={styles.hint}>
          <Icon name="info-circle" size="sm" />
          <span>{showHint}</span>
        </div>
      )}

      {/* Success message */}
      {isCompleted && displayedResult === 'correct' && (
        <div className={styles.success}>
          <Icon name="check-circle" size="lg" />
          <span>Correct! Well done.</span>
        </div>
      )}

      {/* Revealed message */}
      {isRevealed && (
        <div className={styles.revealed}>
          <Icon name="info-circle" size="sm" />
          <span>The correct answer{correctIds.size > 1 ? 's have' : ' has'} been revealed above.</span>
        </div>
      )}

      {/* Actions */}
      {(showCheckButton || (canSkip && !isCompleted)) && (
        <div className={styles.actions}>
          {showCheckButton && (
            <Button onClick={handleCheckAnswer} disabled={disabled || isBlocked}>
              Check Answer
            </Button>
          )}

          {canSkip && !isCompleted && (
            <Button
              variant="secondary"
              fill="text"
              onClick={handleSkip}
              disabled={disabled}
              data-testid={testIds.interactive.quizSkipButton(stepId)}
            >
              Skip
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

// ============ Styles ============

const shake = keyframes`
  0%, 100% { transform: translateX(0); }
  10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
  20%, 40%, 60%, 80% { transform: translateX(4px); }
`;

const pulse = keyframes`
  0% { transform: scale(1); }
  50% { transform: scale(1.05); }
  100% { transform: scale(1); }
`;

const getQuizStyles = (theme: GrafanaTheme2) => {
  // Purple label to match Callout's "colored label" treatment (see
  // content-html.styles.ts) with a different accent so the two read as
  // distinct at a glance — but scoped to the label text only. The container
  // itself stays neutral regardless of answer state: a left-border accent or
  // a success-tinted background here would compete with the per-choice
  // correct/incorrect highlighting and the success message box, all in the
  // same small area.
  const accent = theme.visualization.getColorByName('purple');

  return {
    container: css`
      background: ${theme.colors.background.secondary};
      border: 1px solid ${theme.colors.border.weak};
      border-radius: ${theme.shape.radius.default};
      padding: ${theme.spacing(2)};
      margin: ${theme.spacing(1.5)} 0;
      transition: all 0.2s ease;
    `,

    blocked: css`
      opacity: 0.7;
      pointer-events: none;
    `,

    header: css`
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: ${theme.spacing(1)};
      margin-bottom: ${theme.spacing(1)};
    `,

    headerLabel: css`
      display: flex;
      align-items: center;
      gap: ${theme.spacing(0.5)};
      color: ${accent};
      font-weight: ${theme.typography.fontWeightBold};
      font-size: ${theme.typography.bodySmall.fontSize};
      text-transform: uppercase;
      letter-spacing: 0.02em;
    `,

    headerIcon: css`
      flex-shrink: 0;
    `,

    questionContent: css`
      font-weight: ${theme.typography.fontWeightMedium};
      margin-bottom: ${theme.spacing(2)};

      p {
        margin: 0;
      }
    `,

    blockedMessage: css`
      display: flex;
      align-items: center;
      gap: ${theme.spacing(1)};
      padding: ${theme.spacing(1)} ${theme.spacing(1.5)};
      background: ${theme.colors.warning.transparent};
      border-radius: ${theme.shape.radius.default};
      color: ${theme.colors.warning.text};
      font-size: ${theme.typography.bodySmall.fontSize};
      margin-bottom: ${theme.spacing(1.5)};
    `,

    choices: css`
      display: flex;
      flex-direction: column;
      gap: ${theme.spacing(1)};
      margin-bottom: ${theme.spacing(2)};
    `,

    choicesCompact: css`
      flex-direction: row;
      flex-wrap: wrap;
    `,

    choicesGrid: css`
      display: grid;
      grid-template-columns: repeat(2, 1fr);
    `,

    shake: css`
      animation: ${shake} 0.5s ease;
    `,

    choice: css`
      display: flex;
      align-items: center;
      gap: ${theme.spacing(1.5)};
      padding: ${theme.spacing(1.5)} ${theme.spacing(2)};
      background: ${theme.colors.background.primary};
      border: 1px solid ${theme.colors.border.weak};
      border-radius: ${theme.shape.radius.default};
      cursor: pointer;
      transition: all 0.15s ease;
      text-align: left;
      width: 100%;

      &:hover:not(:disabled) {
        border-color: ${theme.colors.border.medium};
        background: ${theme.colors.action.hover};
      }

      &:focus-visible {
        outline: 2px solid ${theme.colors.primary.main};
        outline-offset: 2px;
      }

      &:disabled {
        cursor: default;
      }
    `,

    choiceCompact: css`
      width: auto;
      flex: 1 1 0;
      min-width: 0;
      justify-content: center;
      text-align: center;
    `,

    choiceGridItem: css`
      width: 100%;
      justify-content: center;
      text-align: center;
    `,

    choiceDefault: css``,

    choiceSelected: css`
      border-color: ${theme.colors.primary.border};
      background: ${theme.colors.primary.transparent};
    `,

    choiceCorrect: css`
      border-color: ${theme.colors.success.border};
      background: ${theme.colors.success.transparent};
      animation: ${pulse} 0.3s ease;
    `,

    choiceIncorrect: css`
      border-color: ${theme.colors.error.border};
      background: ${theme.colors.error.transparent};
    `,

    choiceRevealed: css`
      border-color: ${theme.colors.success.border};
      background: ${theme.colors.success.transparent};
    `,

    choiceIndicator: css`
      flex-shrink: 0;
    `,

    checkbox: css`
      display: flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border: 2px solid ${theme.colors.border.strong};
      border-radius: 3px;
      background: ${theme.colors.background.primary};
      transition: all 0.15s ease;
    `,

    checked: css`
      background: ${theme.colors.primary.main};
      border-color: ${theme.colors.primary.main};
      color: ${theme.colors.primary.contrastText};
    `,

    radio: css`
      display: flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border: 2px solid ${theme.colors.border.strong};
      border-radius: 50%;
      background: ${theme.colors.background.primary};
      transition: all 0.15s ease;
      box-sizing: border-box;

      &::after {
        content: '';
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: ${theme.colors.primary.main};
        transform: scale(0);
        transition: transform 0.15s ease;
      }
    `,

    radioSelected: css`
      border-color: ${theme.colors.primary.main};

      &::after {
        transform: scale(1);
      }
    `,

    choiceText: css`
      flex: 1;
    `,

    correctIcon: css`
      color: ${theme.colors.success.text};
      flex-shrink: 0;
    `,

    incorrectIcon: css`
      color: ${theme.colors.error.text};
      flex-shrink: 0;
    `,

    revealedIcon: css`
      color: ${theme.colors.success.text};
      flex-shrink: 0;
    `,

    hint: css`
      display: flex;
      align-items: flex-start;
      gap: ${theme.spacing(1)};
      padding: ${theme.spacing(1.5)};
      background: ${theme.colors.warning.transparent};
      border: 1px solid ${theme.colors.warning.border};
      border-radius: ${theme.shape.radius.default};
      color: ${theme.colors.warning.text};
      font-size: ${theme.typography.bodySmall.fontSize};
      margin-bottom: ${theme.spacing(2)};

      svg {
        flex-shrink: 0;
        margin-top: 2px;
      }
    `,

    success: css`
      display: flex;
      align-items: center;
      gap: ${theme.spacing(1)};
      padding: ${theme.spacing(1.5)};
      background: ${theme.colors.success.transparent};
      border: 1px solid ${theme.colors.success.border};
      border-radius: ${theme.shape.radius.default};
      color: ${theme.colors.success.text};
      font-weight: ${theme.typography.fontWeightMedium};
      margin-bottom: ${theme.spacing(2)};
      animation: ${pulse} 0.3s ease;
    `,

    revealed: css`
      display: flex;
      align-items: center;
      gap: ${theme.spacing(1)};
      padding: ${theme.spacing(1.5)};
      background: ${theme.colors.info.transparent};
      border: 1px solid ${theme.colors.info.border};
      border-radius: ${theme.shape.radius.default};
      color: ${theme.colors.text.secondary};
      font-size: ${theme.typography.bodySmall.fontSize};
      margin-bottom: ${theme.spacing(2)};
    `,

    actions: css`
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: ${theme.spacing(1.5)};
    `,

    attempts: css`
      color: ${theme.colors.text.secondary};
      font-size: ${theme.typography.bodySmall.fontSize};
      white-space: nowrap;
    `,
  };
};

export default InteractiveQuiz;
