import type { ConditionInput } from '../../types/requirements.types';
import React, { useState, useCallback, useMemo, useEffect, useId, useLayoutEffect, useRef } from 'react';
import { css, cx, keyframes } from '@emotion/css';
import { Button, Checkbox, Icon, RadioButtonDot, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';

import { useStepChecker } from '../../requirements-manager';
import {
  reportAppInteraction,
  reportStepSkipped,
  UserInteraction,
  buildInteractiveStepProperties,
} from '../../lib/analytics';
import { testIds } from '../../constants/testIds';
import { markStepCompleted, resetStep, useStepCompletion } from '../../global-state/completion-store';
import type { ProgressReason } from '../../global-state/progress-events';
import { getLearningIconTileStyle } from '../../styles/learning-icon-tile.styles';
import { getTrackedStepRootAttributes } from './tracked-step-root-attributes';

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
  requirements?: ConditionInput;
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
  const choiceGroupId = useId();
  const questionId = `${choiceGroupId}-question`;
  const questionRef = useRef<HTMLDivElement>(null);
  const [hasLongQuestion, setHasLongQuestion] = useState(false);

  useLayoutEffect(() => {
    const element = questionRef.current;
    if (!element) {
      return;
    }

    const measure = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
      setHasLongQuestion(element.offsetHeight > 2 * lineHeight + 1);
    };

    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [children, question]);

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

  const handleSkip = useCallback(() => {
    if (isCompleted) {
      return;
    }
    if (markSkipped) {
      markSkipped();
    }
    persistCompletion('skipped');
    reportStepSkipped(
      { targetAction: 'quiz', interactionLocation: 'interactive_quiz', skipReason: 'user' },
      { stepId, stepIndex, totalSteps, sectionId, sectionTitle }
    );
    if (onStepComplete && stepId) {
      onStepComplete(stepId);
    }
  }, [
    isCompleted,
    markSkipped,
    onStepComplete,
    stepId,
    persistCompletion,
    stepIndex,
    totalSteps,
    sectionId,
    sectionTitle,
  ]);

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

  // Determine if we should show the blocked state
  const isBlocked = !isEnabled && !isCompleted;
  const showCheckButton = !isCompleted && !isRevealed && displayedSelection.size > 0;
  const choicesDisabled = isCompleted || isRevealed || isBlocked;
  const attemptsRemaining = completionMode === 'max-attempts' ? maxAttempts - attempts : null;
  const showAttemptsRemaining = attemptsRemaining !== null && !isCompleted && !isRevealed;
  const firstCorrectChoiceId = displayChoices.find((choice) => choice.correct)?.id;

  return (
    <div
      className={cx('journey-quiz', styles.layout)}
      {...getTrackedStepRootAttributes('quiz', stepId)}
      data-testid={testIds.interactive.quiz(stepId)}
    >
      <div className={cx(styles.container, { [styles.blocked]: isBlocked })}>
        <div className={styles.header}>
          <span className={cx(styles.questionIcon, hasLongQuestion && styles.topAligned)} aria-hidden="true">
            <Icon name="question-circle" size="lg" />
          </span>
          <div className={styles.questionContent} id={questionId} ref={questionRef}>
            {children ?? question}
          </div>
          {showAttemptsRemaining && (
            <span className={styles.attempts}>
              {attemptsRemaining} attempt{attemptsRemaining !== 1 ? 's' : ''} remaining
            </span>
          )}
        </div>

        <div className={styles.answerPanel}>
          {isBlocked && (
            <div className={styles.blockedMessage}>
              <Icon name="lock" size="sm" />
              <span>{explanation || 'Complete previous step'}</span>
            </div>
          )}
          <div
            role={multiSelect ? 'group' : 'radiogroup'}
            aria-labelledby={questionId}
            className={cx(styles.choices, displayedResult === 'incorrect' && styles.shake)}
            key={shakeKey}
          >
            {displayChoices.map((choice, index) => {
              const state = getChoiceState(choice);
              const isSelected = displayedSelection.has(choice.id);
              const controlProps = {
                id: `${choiceGroupId}-${index}`,
                label: choice.text,
                onChange: () => handleChoiceClick(choice.id),
                disabled: choicesDisabled,
                'aria-invalid': state === 'incorrect' || undefined,
                'data-testid': testIds.interactive.quizChoice(stepId, choice.id),
              };

              return (
                <div key={choice.id} className={styles.choice} data-answer-state={state}>
                  {multiSelect ? (
                    <Checkbox {...controlProps} value={isSelected} htmlValue={choice.id} />
                  ) : (
                    <RadioButtonDot {...controlProps} name={choiceGroupId} checked={isSelected} value={choice.id} />
                  )}
                  <div
                    role={!multiSelect || choice.id === firstCorrectChoiceId ? 'status' : undefined}
                    className={styles.correctStatus}
                  >
                    {state === 'correct' && (
                      <>
                        <Icon name="check" size="sm" />
                        <span>Correct</span>
                      </>
                    )}
                  </div>
                  {state === 'revealed' && <Icon name="check" size="sm" className={styles.revealedIcon} />}
                </div>
              );
            })}
          </div>

          <div className={styles.hint} aria-live="polite">
            {!isCompleted && showHint && (
              <>
                <span className={styles.hintIcon}>
                  <Icon name="times" size="sm" />
                </span>
                <span>{showHint}</span>
              </>
            )}
          </div>

          {isRevealed && (
            <div className={styles.revealed}>
              <Icon name="info-circle" size="sm" />
              <span>The correct answer{correctIds.size > 1 ? 's have' : ' has'} been revealed above.</span>
            </div>
          )}

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
      </div>
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
  return {
    layout: css`
      margin: ${theme.spacing(1.5)} 0;
    `,

    container: css`
      background: ${theme.colors.background.primary};
      border-radius: ${theme.shape.radius.lg};
      box-shadow: ${theme.shadows.z1};
    `,

    header: css`
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
      gap: ${theme.spacing(0.5, 1.5)};
      padding: ${theme.spacing(2)};
    `,

    questionIcon: getLearningIconTileStyle(theme, 4.5, { bright: true }),
    topAligned: css({ alignSelf: 'start' }),

    answerPanel: css`
      display: flex;
      flex-direction: column;
      gap: ${theme.spacing(1)};
      padding: calc(${theme.spacing(2)} - 1px);
      background: ${theme.colors.background.secondary};
      border: 1px solid ${theme.colors.border.weak};
      border-radius: ${theme.shape.radius.lg};
    `,

    blocked: css`
      opacity: 0.7;
      pointer-events: none;
    `,

    questionContent: css({
      ...theme.typography.base,
      overflowWrap: 'anywhere',
      p: { margin: 0 },
    }),

    blockedMessage: css`
      display: flex;
      align-items: center;
      gap: ${theme.spacing(1)};
      padding: ${theme.spacing(1)} ${theme.spacing(1.5)};
      background: ${theme.colors.warning.transparent};
      border-radius: ${theme.shape.radius.default};
      color: ${theme.colors.warning.text};
      font-size: ${theme.typography.bodySmall.fontSize};
    `,

    choices: css`
      display: flex;
      flex-direction: column;
      gap: 1px;
    `,

    shake: css`
      animation: ${shake} 0.5s ease;
    `,

    choice: css({
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      borderRadius: theme.shape.radius.default,
      '& > label': {
        ...theme.typography.base,
        boxSizing: 'border-box',
        display: 'grid',
        alignContent: 'center',
        alignItems: 'center',
        gridTemplateColumns: `${theme.spacing(2)} minmax(0, 1fr)`,
        columnGap: theme.spacing(1),
        flex: 1,
        minWidth: 0,
        minHeight: theme.spacing(5),
        padding: theme.spacing(0.5, 1),
        color: theme.colors.text.primary,
        cursor: 'pointer',
        '& > :last-child': { font: 'inherit', color: 'inherit', overflowWrap: 'anywhere' },
      },
      '&:hover:has(input:enabled)': {
        backgroundImage: `linear-gradient(${theme.colors.action.hover}, ${theme.colors.action.hover})`,
      },
      '&:has(input:disabled) > label, &:has(input:disabled) > label > :last-child': { cursor: 'default' },
      '&[data-answer-state="correct"]': {
        backgroundColor: theme.colors.success.subtleBackground,
        boxShadow: `inset 0 0 0 1px ${theme.colors.success.border}`,
        animation: `${pulse} 0.3s ease`,
      },
      '&[data-answer-state="incorrect"]': {
        backgroundColor: theme.colors.error.transparent,
        boxShadow: `inset 0 0 0 1px ${theme.colors.error.border}`,
      },
      '&:has(> svg) > label': {
        paddingInlineEnd: theme.spacing(4),
      },
    }),

    correctStatus: css({
      ...theme.typography.sm,
      display: 'flex',
      alignItems: 'center',
      flexShrink: 0,
      gap: theme.spacing(0.5),
      color: theme.colors.success.text,
      '&:empty': { position: 'absolute' },
      '&:not(:empty)': { paddingInlineEnd: theme.spacing(1) },
    }),

    revealedIcon: css({
      position: 'absolute',
      insetInlineEnd: theme.spacing(1),
      top: '50%',
      transform: 'translateY(-50%)',
      pointerEvents: 'none',
      color: theme.colors.text.secondary,
    }),

    hint: css({
      ...theme.typography.sm,
      fontWeight: theme.typography.fontWeightRegular,
      display: 'flex',
      alignItems: 'flex-start',
      gap: theme.spacing(0.5),
      color: theme.colors.error.text,
      '&:empty': { position: 'absolute' },
    }),

    hintIcon: css({ display: 'flex', alignItems: 'center', flexShrink: 0, height: '1lh' }),

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
    `,

    actions: css`
      display: flex;
      align-items: center;
      gap: ${theme.spacing(1.5)};
      margin-top: ${theme.spacing(1)};
    `,

    attempts: css`
      grid-column: 2;
      color: ${theme.colors.text.secondary};
      font-size: ${theme.typography.bodySmall.fontSize};
      white-space: nowrap;
    `,
  };
};

export default InteractiveQuiz;
