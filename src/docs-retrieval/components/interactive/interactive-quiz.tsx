import React, { useState, useCallback, useMemo } from 'react';
import { css, cx, keyframes } from '@emotion/css';
import { Button, Icon, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';

import { useStepChecker } from '../../../requirements-manager';
import { reportAppInteraction, UserInteraction } from '../../../lib/analytics';
import { ParsedElement } from '../../content.types';
import { testIds } from '../../../components/testIds';

// ============ Types ============

export interface QuizChoice {
  id: string;
  text: string;
  textElements?: ParsedElement[];
  correct: boolean;
  hint?: string;
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
  /** Rendered children (question content) */
  children?: React.ReactNode;

  // Section integration props
  stepId?: string;
  isEligibleForChecking?: boolean;
  isCompleted?: boolean;
  onStepComplete?: (stepId: string) => void;
  disabled?: boolean;
  resetTrigger?: number;
}

// ============ Component ============

// Counter for generating unique quiz IDs
let quizCounter = 0;

export const InteractiveQuiz: React.FC<InteractiveQuizProps> = ({
  question,
  choices,
  multiSelect = false,
  completionMode = 'correct-only',
  maxAttempts = 3,
  requirements,
  skippable = false,
  children,
  stepId: providedStepId,
  isEligibleForChecking = true,
  isCompleted: parentCompleted = false,
  onStepComplete,
  disabled = false,
  resetTrigger,
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
  const [isLocallyCompleted, setIsLocallyCompleted] = useState(false);
  const [lastResult, setLastResult] = useState<'none' | 'correct' | 'incorrect'>('none');
  const [showHint, setShowHint] = useState<string | null>(null);
  const [isRevealed, setIsRevealed] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  // Requirements checking
  const {
    isEnabled,
    isCompleted: stepCompleted,
    explanation,
    canSkip,
    markSkipped,
  } = useStepChecker({
    requirements,
    stepId,
    isEligibleForChecking,
    skippable,
  });

  // Compute effective completion state
  const isCompleted = parentCompleted || stepCompleted || isLocallyCompleted;

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
      return correctIds.has(Array.from(selectedIds)[0]);
    }
  }, [selectedIds, correctIds, multiSelect]);

  // Handle choice selection
  const handleChoiceClick = useCallback(
    (choiceId: string) => {
      if (isCompleted || isRevealed || !isEnabled) {
        return;
      }

      setSelectedIds((prev) => {
        const newSet = new Set(prev);
        if (multiSelect) {
          // Toggle for multi-select
          if (newSet.has(choiceId)) {
            newSet.delete(choiceId);
          } else {
            newSet.add(choiceId);
          }
        } else {
          // Replace for single-select
          newSet.clear();
          newSet.add(choiceId);
        }
        return newSet;
      });

      // Clear previous result/hint when selection changes
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

    const newAttempts = attempts + 1;
    setAttempts(newAttempts);

    const isCorrect = checkAnswer();

    if (isCorrect) {
      setLastResult('correct');
      setIsLocallyCompleted(true);
      setShowHint(null);

      // Report analytics
      reportAppInteraction(UserInteraction.StepAutoCompleted, {
        stepId,
        quizAttempts: newAttempts,
        correct: true,
      });

      // Notify parent
      if (onStepComplete && stepId) {
        onStepComplete(stepId);
      }
    } else {
      setLastResult('incorrect');
      setShakeKey((k) => k + 1);

      // Find hint for selected wrong answer
      const selectedWrong = choices.find((c) => selectedIds.has(c.id) && !c.correct);
      if (selectedWrong?.hint) {
        setShowHint(selectedWrong.hint);
      } else {
        setShowHint("That's not quite right. Try again!");
      }

      // Check if max attempts reached (for max-attempts mode)
      if (completionMode === 'max-attempts' && newAttempts >= maxAttempts) {
        setIsRevealed(true);
        setIsLocallyCompleted(true);

        // Report analytics
        reportAppInteraction(UserInteraction.StepAutoCompleted, {
          stepId,
          quizAttempts: newAttempts,
          correct: false,
          revealed: true,
        });

        // Notify parent
        if (onStepComplete && stepId) {
          onStepComplete(stepId);
        }
      }
    }
  }, [selectedIds, attempts, checkAnswer, stepId, onStepComplete, completionMode, maxAttempts, choices]);

  // Handle skip
  const handleSkip = useCallback(() => {
    if (markSkipped) {
      markSkipped();
    }
    setIsLocallyCompleted(true);
    if (onStepComplete && stepId) {
      onStepComplete(stepId);
    }
  }, [markSkipped, onStepComplete, stepId]);

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

  return (
    <div
      className={cx(styles.container, {
        [styles.completed]: isCompleted,
        [styles.blocked]: isBlocked,
      })}
      data-testid={testIds.interactive.quiz(stepId)}
    >
      {/* Question */}
      <div className={styles.question}>
        <Icon name="question-circle" className={styles.questionIcon} />
        <div className={styles.questionContent}>{children}</div>
      </div>

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
          [styles.shake]: displayedResult === 'incorrect',
        })}
        key={shakeKey}
      >
        {choices.map((choice) => {
          const state = getChoiceState(choice);
          const isSelected = displayedSelection.has(choice.id);

          return (
            <button
              key={choice.id}
              type="button"
              className={cx(styles.choice, getChoiceClassName(state))}
              onClick={() => handleChoiceClick(choice.id)}
              disabled={isCompleted || isRevealed || isBlocked}
              aria-pressed={isSelected}
              data-testid={testIds.interactive.quizChoice(stepId, choice.id)}
            >
              <span className={styles.choiceIndicator}>
                {multiSelect ? (
                  <span className={cx(styles.checkbox, { [styles.checked]: isSelected })}>
                    {isSelected && <Icon name="check" size="xs" />}
                  </span>
                ) : (
                  <span className={cx(styles.radio, { [styles.radioSelected]: isSelected })} />
                )}
              </span>
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
      <div className={styles.actions}>
        {showCheckButton && (
          <Button onClick={handleCheckAnswer} disabled={disabled || isBlocked}>
            Check Answer
          </Button>
        )}

        {attemptsRemaining !== null && !isCompleted && !isRevealed && (
          <span className={styles.attempts}>
            {attemptsRemaining} attempt{attemptsRemaining !== 1 ? 's' : ''} remaining
          </span>
        )}

        {canSkip && !isCompleted && (
          <Button variant="secondary" fill="text" onClick={handleSkip} disabled={disabled}>
            Skip
          </Button>
        )}
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

const getQuizStyles = (theme: GrafanaTheme2) => ({
  container: css`
    background: ${theme.colors.background.secondary};
    border: 1px solid ${theme.colors.border.weak};
    border-radius: ${theme.shape.radius.default};
    padding: ${theme.spacing(2)};
    margin: ${theme.spacing(1.5)} 0;
    transition: all 0.2s ease;
  `,

  completed: css`
    border-color: ${theme.colors.success.border};
    background: ${theme.colors.success.transparent};
  `,

  blocked: css`
    opacity: 0.7;
    pointer-events: none;
  `,

  question: css`
    display: flex;
    gap: ${theme.spacing(1)};
    margin-bottom: ${theme.spacing(2)};
  `,

  questionIcon: css`
    color: ${theme.colors.primary.text};
    flex-shrink: 0;
    margin-top: 2px;
  `,

  questionContent: css`
    flex: 1;
    font-weight: ${theme.typography.fontWeightMedium};

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
    gap: ${theme.spacing(1.5)};
  `,

  attempts: css`
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
    margin-left: auto;
  `,
});

export default InteractiveQuiz;
