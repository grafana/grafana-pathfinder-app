/**
 * Tests for InteractiveQuiz — issue #851
 *
 * Quiz answer choices are shuffled by default to prevent learners from
 * memorizing answer positions. Authors can opt out at the block level
 * (shuffle=false) or pin individual choices to their authored index
 * (pinned=true). Selection, completion, hints, and analytics are all
 * keyed by `choice.id`, so reordering is safe.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { InteractiveQuiz, resetQuizCounter, shuffleQuizChoices, type QuizChoice } from './interactive-quiz';
import { reportStepSkipped } from '../../lib/analytics';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: { StepAutoCompleted: 'auto' },
  buildInteractiveStepProperties: jest.fn((props) => props),
  reportStepSkipped: jest.fn(),
}));

// Stateful mock so the test can exercise the full mark-complete → re-render
// flow. The real store is exercised in `completion-store.test.tsx`.
//
// We capture the `reason` argument on each `markStepCompleted` call so the
// regression test for the skip-reason bug can assert that the quiz writes
// `'skipped'` (not `'manual'`) when the user clicks Skip.
jest.mock('../../global-state/completion-store', () => {
  const completed = new Map<string, 'manual' | 'skipped' | 'objectives'>();
  return {
    useStepCompletion: jest.fn((stepId: string) => ({
      completed: completed.has(stepId),
      reason: completed.get(stepId) ?? null,
    })),
    markStepCompleted: jest.fn(
      (stepId: string, _sectionId: string | undefined, reason: 'manual' | 'skipped' | 'objectives') => {
        completed.set(stepId, reason);
      }
    ),
    resetStep: jest.fn((stepId: string) => {
      completed.delete(stepId);
    }),
    STANDALONE_SECTION_ID: '__standalone__',
    __resetMockStore: () => completed.clear(),
    __getStoredReason: (stepId: string) => completed.get(stepId) ?? null,
  };
});

jest.mock('../../requirements-manager', () => ({
  useStepChecker: jest.fn(() => ({
    isEnabled: true,
    isCompleted: false,
    explanation: null,
    canSkip: false,
    markSkipped: jest.fn(),
    resetStep: jest.fn(),
  })),
}));

// ─── shuffleQuizChoices (pure helper) ────────────────────────────────────────

describe('shuffleQuizChoices', () => {
  const choices: QuizChoice[] = [
    { id: 'a', text: 'Alpha', correct: false },
    { id: 'b', text: 'Bravo', correct: true },
    { id: 'c', text: 'Charlie', correct: false },
    { id: 'd', text: 'Delta', correct: false },
  ];

  it('preserves all choices (same set, same length)', () => {
    const rng = mulberry32(42);
    const shuffled = shuffleQuizChoices(choices, rng);
    expect(shuffled).toHaveLength(choices.length);
    expect(new Set(shuffled.map((c) => c.id))).toEqual(new Set(choices.map((c) => c.id)));
  });

  it('reorders non-pinned choices', () => {
    // mulberry32(7) yields a non-identity permutation for 4 items.
    const rng = mulberry32(7);
    const shuffled = shuffleQuizChoices(choices, rng);
    const orderChanged = shuffled.some((c, i) => c.id !== choices[i]!.id);
    expect(orderChanged).toBe(true);
  });

  it('keeps pinned choices at their authored index', () => {
    const withPinned: QuizChoice[] = [
      { id: 'a', text: 'Alpha', correct: false },
      { id: 'b', text: 'Bravo', correct: true },
      { id: 'c', text: 'Charlie', correct: false },
      { id: 'd', text: 'All of the above', correct: false, pinned: true },
    ];

    // Run several deterministic seeds — pinned must always end up at index 3.
    for (const seed of [1, 7, 42, 123, 9999]) {
      const shuffled = shuffleQuizChoices(withPinned, mulberry32(seed));
      expect(shuffled[3]!.id).toBe('d');
    }
  });

  it('keeps multiple pinned choices at their authored indices', () => {
    const withPinned: QuizChoice[] = [
      { id: 'a', text: 'Intro', correct: false, pinned: true },
      { id: 'b', text: 'Middle 1', correct: false },
      { id: 'c', text: 'Middle 2', correct: true },
      { id: 'd', text: 'Outro', correct: false, pinned: true },
    ];

    const shuffled = shuffleQuizChoices(withPinned, mulberry32(123));
    expect(shuffled[0]!.id).toBe('a');
    expect(shuffled[3]!.id).toBe('d');
    expect(new Set([shuffled[1]!.id, shuffled[2]!.id])).toEqual(new Set(['b', 'c']));
  });

  it('returns a copy (does not mutate the input array)', () => {
    const input = choices.slice();
    const snapshot = input.map((c) => c.id);
    shuffleQuizChoices(input, mulberry32(42));
    expect(input.map((c) => c.id)).toEqual(snapshot);
  });

  it('handles 0 and 1 choice arrays', () => {
    expect(shuffleQuizChoices([])).toEqual([]);
    const one: QuizChoice[] = [{ id: 'a', text: 'A', correct: true }];
    expect(shuffleQuizChoices(one)).toEqual(one);
  });
});

// ─── Component rendering ─────────────────────────────────────────────────────

const readChoiceOrder = () =>
  screen.getAllByRole<HTMLInputElement>('radio').map((control) => control.labels?.[0]?.textContent);

describe('InteractiveQuiz: shuffle behavior', () => {
  beforeEach(() => {
    resetQuizCounter();
    (require('../../global-state/completion-store') as { __resetMockStore: () => void }).__resetMockStore();
  });

  const choices: QuizChoice[] = [
    { id: 'a', text: 'Alpha', correct: false },
    { id: 'b', text: 'Bravo', correct: true },
    { id: 'c', text: 'Charlie', correct: false },
    { id: 'd', text: 'Delta', correct: false },
  ];

  it('renders in authored order when shuffle=false', () => {
    render(
      <InteractiveQuiz question="Pick one" choices={choices} shuffle={false}>
        Pick one
      </InteractiveQuiz>
    );
    expect(readChoiceOrder()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);
  });

  it('renders in shuffled order when shuffle=true', () => {
    // Seed Math.random with a value known to produce a non-identity permutation.
    const spy = jest.spyOn(Math, 'random');
    const seq = mulberry32(7);
    spy.mockImplementation(() => seq());

    try {
      render(
        <InteractiveQuiz question="Pick one" choices={choices} shuffle={true}>
          Pick one
        </InteractiveQuiz>
      );
      const rendered = readChoiceOrder();
      const orderChanged = rendered.some((label, i) => label !== choices[i]!.text);
      expect(orderChanged).toBe(true);
      // All four choices still present.
      expect(new Set(rendered)).toEqual(new Set(['Alpha', 'Bravo', 'Charlie', 'Delta']));
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps a pinned choice at its authored index even when shuffled', () => {
    const withPinned: QuizChoice[] = [
      { id: 'a', text: 'Alpha', correct: false },
      { id: 'b', text: 'Bravo', correct: false },
      { id: 'c', text: 'Charlie', correct: true },
      { id: 'd', text: 'All of the above', correct: false, pinned: true },
    ];

    // Try a handful of seeds — pinned choice must always be last.
    for (const seed of [1, 7, 42]) {
      const spy = jest.spyOn(Math, 'random');
      const seq = mulberry32(seed);
      spy.mockImplementation(() => seq());

      try {
        const { unmount } = render(
          <InteractiveQuiz question="Q" choices={withPinned} shuffle={true}>
            Q
          </InteractiveQuiz>
        );
        expect(readChoiceOrder().at(-1)).toBe('All of the above');
        unmount();
      } finally {
        spy.mockRestore();
      }
    }
  });

  it('selecting the correct answer completes the quiz regardless of rendered position', () => {
    const spy = jest.spyOn(Math, 'random');
    const seq = mulberry32(7);
    spy.mockImplementation(() => seq());

    try {
      render(
        <InteractiveQuiz question="Q" choices={choices} shuffle={true}>
          Q
        </InteractiveQuiz>
      );

      fireEvent.click(screen.getByRole('radio', { name: 'Bravo' }));
      fireEvent.click(screen.getByRole('button', { name: /Check Answer/i }));

      expect(screen.getByText('Correct')).toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });

  it('shows the matching hint when a wrong shuffled choice is selected', () => {
    const withHints: QuizChoice[] = [
      { id: 'a', text: 'Alpha', correct: false, hint: 'Alpha hint' },
      { id: 'b', text: 'Bravo', correct: true },
      { id: 'c', text: 'Charlie', correct: false, hint: 'Charlie hint' },
    ];

    const spy = jest.spyOn(Math, 'random');
    const seq = mulberry32(7);
    spy.mockImplementation(() => seq());

    try {
      render(
        <InteractiveQuiz question="Q" choices={withHints} shuffle={true}>
          Q
        </InteractiveQuiz>
      );
      fireEvent.click(screen.getByRole('radio', { name: 'Charlie' }));
      fireEvent.click(screen.getByRole('button', { name: /Check Answer/i }));
      expect(screen.getByText('Charlie hint')).toBeInTheDocument();
      const incorrectOption = screen.getByRole('radio', { name: 'Charlie' });
      expect(incorrectOption).toHaveAttribute('aria-invalid', 'true');
      expect(incorrectOption.closest('[data-answer-state]')).toHaveAttribute('data-answer-state', 'incorrect');
      expect(screen.queryByText('Incorrect')).not.toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });
});

// ─── Stability across re-renders ─────────────────────────────────────────────

describe('InteractiveQuiz: render-order stability', () => {
  beforeEach(() => {
    resetQuizCounter();
    (require('../../global-state/completion-store') as { __resetMockStore: () => void }).__resetMockStore();
  });

  const choices: QuizChoice[] = [
    { id: 'a', text: 'Alpha', correct: false },
    { id: 'b', text: 'Bravo', correct: true },
    { id: 'c', text: 'Charlie', correct: false },
    { id: 'd', text: 'Delta', correct: false },
  ];

  it('does not reshuffle when the parent re-renders with a new choices array reference', () => {
    const spy = jest.spyOn(Math, 'random');
    const seq = mulberry32(7);
    spy.mockImplementation(() => seq());

    try {
      // Fresh array reference on each render — mirrors a parent that does not memoize.
      const { rerender } = render(
        <InteractiveQuiz question="Q" choices={[...choices]} shuffle={true}>
          Q
        </InteractiveQuiz>
      );
      const initial = readChoiceOrder();

      for (let i = 0; i < 5; i++) {
        rerender(
          <InteractiveQuiz question="Q" choices={[...choices]} shuffle={true}>
            Q
          </InteractiveQuiz>
        );
        expect(readChoiceOrder()).toEqual(initial);
      }
    } finally {
      spy.mockRestore();
    }
  });

  it('preserves the correct/completed state and rendered order through a parent re-render', () => {
    const spy = jest.spyOn(Math, 'random');
    const seq = mulberry32(7);
    spy.mockImplementation(() => seq());

    try {
      const { rerender } = render(
        <InteractiveQuiz question="Q" choices={[...choices]} shuffle={true}>
          Q
        </InteractiveQuiz>
      );
      const orderBefore = readChoiceOrder();

      // Answer correctly.
      fireEvent.click(screen.getByRole('radio', { name: 'Bravo' }));
      fireEvent.click(screen.getByRole('button', { name: /Check Answer/i }));
      expect(screen.getByText('Correct')).toBeInTheDocument();

      // Force a parent re-render with an unrelated prop change (and a fresh choices reference).
      rerender(
        <InteractiveQuiz question="Q (edited)" choices={[...choices]} shuffle={true}>
          Q (edited)
        </InteractiveQuiz>
      );

      // Completion message still shown.
      expect(screen.getByText('Correct')).toBeInTheDocument();
      // Rendered order is unchanged — the answered choice stays where the user clicked it.
      expect(readChoiceOrder()).toEqual(orderBefore);
    } finally {
      spy.mockRestore();
    }
  });

  it('preserves the incorrect/hint state and rendered order through a parent re-render', () => {
    const withHints: QuizChoice[] = [
      { id: 'a', text: 'Alpha', correct: false, hint: 'Alpha hint' },
      { id: 'b', text: 'Bravo', correct: true },
      { id: 'c', text: 'Charlie', correct: false, hint: 'Charlie hint' },
    ];

    const spy = jest.spyOn(Math, 'random');
    const seq = mulberry32(7);
    spy.mockImplementation(() => seq());

    try {
      const { rerender } = render(
        <InteractiveQuiz question="Q" choices={[...withHints]} shuffle={true}>
          Q
        </InteractiveQuiz>
      );
      const orderBefore = readChoiceOrder();

      // Pick a wrong answer so the hint surfaces.
      fireEvent.click(screen.getByRole('radio', { name: 'Charlie' }));
      fireEvent.click(screen.getByRole('button', { name: /Check Answer/i }));
      expect(screen.getByText('Charlie hint')).toBeInTheDocument();

      // Force a re-render with a new choices reference.
      rerender(
        <InteractiveQuiz question="Q" choices={[...withHints]} shuffle={true}>
          Q
        </InteractiveQuiz>
      );

      // Hint still visible, order unchanged.
      expect(screen.getByText('Charlie hint')).toBeInTheDocument();
      expect(readChoiceOrder()).toEqual(orderBefore);
    } finally {
      spy.mockRestore();
    }
  });

  it('reshuffles when resetTrigger increments', () => {
    // Use a seed where the first shuffle differs from the second.
    const spy = jest.spyOn(Math, 'random');
    const seq = mulberry32(7);
    spy.mockImplementation(() => seq());

    try {
      const { rerender } = render(
        <InteractiveQuiz question="Q" choices={choices} shuffle={true} resetTrigger={0}>
          Q
        </InteractiveQuiz>
      );
      const orderBefore = readChoiceOrder();

      rerender(
        <InteractiveQuiz question="Q" choices={choices} shuffle={true} resetTrigger={1}>
          Q
        </InteractiveQuiz>
      );
      const orderAfter = readChoiceOrder();

      // Both orders contain the same set of choices.
      expect(new Set(orderAfter)).toEqual(new Set(orderBefore));
      // The reset effect drew fresh values from the RNG, so the order changed.
      expect(orderAfter).not.toEqual(orderBefore);
    } finally {
      spy.mockRestore();
    }
  });
});

// ─── Skip reason ─────────────────────────────────────────────────────────────

describe('InteractiveQuiz: skip reason', () => {
  // Re-mock the requirements manager so `canSkip` is true and a real
  // `markSkipped` exists — the default mock in this file leaves both
  // disabled, which would short-circuit the skip button.
  beforeEach(() => {
    resetQuizCounter();
    (require('../../global-state/completion-store') as { __resetMockStore: () => void }).__resetMockStore();
    const { useStepChecker } = require('../../requirements-manager') as {
      useStepChecker: jest.Mock;
    };
    useStepChecker.mockImplementation(() => ({
      isEnabled: true,
      isCompleted: false,
      explanation: null,
      canSkip: true,
      markSkipped: jest.fn(),
      resetStep: jest.fn(),
    }));
  });

  const choices: QuizChoice[] = [
    { id: 'a', text: 'Alpha', correct: false },
    { id: 'b', text: 'Bravo', correct: true },
  ];

  it('writes reason="skipped" to the store when the user clicks Skip', () => {
    render(
      <InteractiveQuiz question="Q" choices={choices} skippable shuffle={false} stepId="quiz-skip-test">
        Q
      </InteractiveQuiz>
    );

    fireEvent.click(screen.getByTestId('interactive-quiz-skip-quiz-skip-test'));

    const store = require('../../global-state/completion-store') as {
      __getStoredReason: (stepId: string) => string | null;
    };
    // Before the fix this asserted 'manual' — the store write hardcoded
    // 'manual' even on skip, making the dispatched pathfinder:progress
    // event lie about user intent.
    expect(store.__getStoredReason('quiz-skip-test')).toBe('skipped');
  });

  it('reports one user skip, and offers no Skip once the store records it', () => {
    jest.mocked(reportStepSkipped).mockClear();
    const quiz = () => (
      <InteractiveQuiz
        question="Q"
        choices={choices}
        skippable
        shuffle={false}
        stepId="quiz-skip-report"
        stepIndex={2}
        totalSteps={5}
      >
        Q
      </InteractiveQuiz>
    );
    const { rerender } = render(quiz());

    fireEvent.click(screen.getByTestId('interactive-quiz-skip-quiz-skip-report'));
    rerender(quiz());

    expect(screen.queryByTestId('interactive-quiz-skip-quiz-skip-report')).not.toBeInTheDocument();
    expect(reportStepSkipped).toHaveBeenCalledTimes(1);
    expect(reportStepSkipped).toHaveBeenCalledWith(
      { targetAction: 'quiz', interactionLocation: 'interactive_quiz', skipReason: 'user' },
      expect.objectContaining({ stepId: 'quiz-skip-report', stepIndex: 2, totalSteps: 5 })
    );
  });

  it('writes reason="manual" to the store when the user answers correctly', () => {
    render(
      <InteractiveQuiz question="Q" choices={choices} shuffle={false} stepId="quiz-correct-test">
        Q
      </InteractiveQuiz>
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Bravo' }));
    fireEvent.click(screen.getByRole('button', { name: /Check Answer/i }));

    const store = require('../../global-state/completion-store') as {
      __getStoredReason: (stepId: string) => string | null;
    };
    expect(store.__getStoredReason('quiz-correct-test')).toBe('manual');
  });
});

// ─── Quiz header and answer choices ─────────────────────────────────────────

describe('InteractiveQuiz: question and attempts placement', () => {
  beforeEach(() => {
    resetQuizCounter();
    (require('../../global-state/completion-store') as { __resetMockStore: () => void }).__resetMockStore();
  });

  it('shows the question above the answer panel', () => {
    const choices: QuizChoice[] = [
      { id: 'a', text: 'True', correct: false },
      { id: 'b', text: 'False', correct: true },
    ];
    render(
      <InteractiveQuiz question="Q" choices={choices} shuffle={false}>
        Q
      </InteractiveQuiz>
    );
    const answerPanel = screen.getByRole('radiogroup', { name: 'Q' }).parentElement;
    expect(answerPanel?.previousElementSibling).toContainElement(screen.getByText('Q'));
    expect(screen.queryByText('Knowledge check')).not.toBeInTheDocument();
  });

  it('shows attempts remaining (max-attempts mode) with the question; Check Answer appears only once a choice is selected', () => {
    const choices: QuizChoice[] = [
      { id: 'a', text: 'True', correct: false },
      { id: 'b', text: 'False', correct: true },
    ];
    render(
      <InteractiveQuiz question="Q" choices={choices} shuffle={false} completionMode="max-attempts" maxAttempts={2}>
        Q
      </InteractiveQuiz>
    );
    expect(screen.getByText('Q').parentElement).toContainElement(screen.getByText('2 attempts remaining'));
    expect(screen.queryByRole('button', { name: /Check Answer/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'True' }));
    expect(screen.getByRole('button', { name: /Check Answer/i })).toBeInTheDocument();
  });

  it('does not show an attempts indicator in correct-only mode (the default)', () => {
    const choices: QuizChoice[] = [
      { id: 'a', text: 'True', correct: false },
      { id: 'b', text: 'False', correct: true },
    ];
    render(
      <InteractiveQuiz question="Q" choices={choices} shuffle={false}>
        Q
      </InteractiveQuiz>
    );
    expect(screen.queryByText(/attempts? remaining/i)).not.toBeInTheDocument();
  });
});

describe('InteractiveQuiz: answer choice indicators', () => {
  beforeEach(() => {
    resetQuizCounter();
    (require('../../global-state/completion-store') as { __resetMockStore: () => void }).__resetMockStore();
  });

  it('puts the True/False radios in a group labeled by the question', () => {
    const choices: QuizChoice[] = [
      { id: 'a', text: 'True', correct: false },
      { id: 'b', text: 'False', correct: true },
    ];
    render(
      <InteractiveQuiz question="Q" choices={choices} shuffle={false}>
        Q
      </InteractiveQuiz>
    );
    const group = screen.getByRole('radiogroup', { name: 'Q' });
    const trueOption = screen.getByRole('radio', { name: 'True' });
    const falseOption = screen.getByRole('radio', { name: 'False' });
    expect(group).toContainElement(trueOption);
    expect(group).toContainElement(falseOption);
    fireEvent.click(screen.getByText('True'));
    expect(trueOption).toBeChecked();
    fireEvent.click(screen.getByText('False'));
    expect(falseOption).toBeChecked();
    expect(trueOption).not.toBeChecked();
  });

  it('keeps the entire long choice as the radio label', () => {
    const choices: QuizChoice[] = [
      { id: 'a', text: 'This is a much longer answer choice than a short label', correct: true },
      { id: 'b', text: 'Also a fairly long second choice for this question', correct: false },
    ];
    render(
      <InteractiveQuiz question="Q" choices={choices} shuffle={false}>
        Q
      </InteractiveQuiz>
    );
    expect(screen.getByRole('radio', { name: choices[0]!.text })).toBeInTheDocument();
  });

  it('renders four short choices as radios', () => {
    const choices: QuizChoice[] = [
      { id: 'a', text: 'One', correct: false },
      { id: 'b', text: 'Two', correct: true },
      { id: 'c', text: 'Three', correct: false },
      { id: 'd', text: 'Four', correct: false },
    ];
    render(
      <InteractiveQuiz question="Q" choices={choices} shuffle={false}>
        Q
      </InteractiveQuiz>
    );
    for (const choice of choices) {
      expect(screen.getByRole('radio', { name: choice.text })).toBeInTheDocument();
    }
  });

  it('puts multi-select checkboxes in a group labeled by the question', () => {
    const choices: QuizChoice[] = [
      { id: 'a', text: 'One', correct: true },
      { id: 'b', text: 'Two', correct: true },
    ];
    render(
      <InteractiveQuiz question="Q" choices={choices} multiSelect shuffle={false}>
        Q
      </InteractiveQuiz>
    );
    const group = screen.getByRole('group', { name: 'Q' });
    const first = screen.getByRole('checkbox', { name: 'One' });
    const second = screen.getByRole('checkbox', { name: 'Two' });
    expect(group).toContainElement(first);
    expect(group).toContainElement(second);
    fireEvent.click(screen.getByText('One'));
    fireEvent.click(screen.getByText('Two'));
    expect(first).toBeChecked();
    expect(second).toBeChecked();
  });
});

describe('InteractiveQuiz: multi-select requires an explicit Check Answer click', () => {
  beforeEach(() => {
    resetQuizCounter();
    (require('../../global-state/completion-store') as { __resetMockStore: () => void }).__resetMockStore();
  });

  const choices: QuizChoice[] = [
    { id: 'a', text: 'Alpha', correct: true },
    { id: 'b', text: 'Bravo', correct: true },
    { id: 'c', text: 'Charlie', correct: false },
  ];

  it('does not complete on the first choice click — requires an explicit Check Answer click', () => {
    render(
      <InteractiveQuiz question="Q" choices={choices} multiSelect shuffle={false}>
        Q
      </InteractiveQuiz>
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Alpha' }));
    expect(screen.queryByText('Correct')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Check Answer/i })).toBeInTheDocument();
  });

  it('completes once all correct choices are selected and Check Answer is clicked', () => {
    render(
      <InteractiveQuiz question="Q" choices={choices} multiSelect shuffle={false}>
        Q
      </InteractiveQuiz>
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Alpha' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bravo' }));
    fireEvent.click(screen.getByRole('button', { name: /Check Answer/i }));
    expect(screen.getByRole('status')).toHaveTextContent('Correct');
    const correctRows = screen.getAllByText('Correct').map((label) => label.closest('[data-answer-state="correct"]'));
    expect(correctRows).toHaveLength(2);
    expect(correctRows[0]).toContainElement(screen.getByRole('checkbox', { name: 'Alpha' }));
    expect(correctRows[1]).toContainElement(screen.getByRole('checkbox', { name: 'Bravo' }));
  });
});

describe('InteractiveQuiz: single-select also requires an explicit Check Answer click', () => {
  beforeEach(() => {
    resetQuizCounter();
    (require('../../global-state/completion-store') as { __resetMockStore: () => void }).__resetMockStore();
  });

  const choices: QuizChoice[] = [
    { id: 'a', text: 'True', correct: false },
    { id: 'b', text: 'False', correct: true },
  ];

  it("does not complete on the choice click alone — matches multi-select, challenge, and data-check's explicit-submit pattern", () => {
    render(
      <InteractiveQuiz question="Q" choices={choices} shuffle={false}>
        Q
      </InteractiveQuiz>
    );
    fireEvent.click(screen.getByRole('radio', { name: 'False' }));
    expect(screen.queryByText('Correct')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Check Answer/i })).toBeInTheDocument();
  });

  it('completes only after Check Answer is clicked', () => {
    render(
      <InteractiveQuiz question="Q" choices={choices} shuffle={false}>
        Q
      </InteractiveQuiz>
    );
    fireEvent.click(screen.getByRole('radio', { name: 'False' }));
    fireEvent.click(screen.getByRole('button', { name: /Check Answer/i }));
    const correctRow = screen.getByText('Correct').closest('[data-answer-state="correct"]');
    expect(correctRow).toContainElement(screen.getByRole('radio', { name: 'False' }));
  });
});

// ─── Deterministic RNG for tests ─────────────────────────────────────────────

/**
 * mulberry32 — small seedable PRNG. We use it instead of Math.random so the
 * tests above are deterministic. https://stackoverflow.com/a/47593316
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
