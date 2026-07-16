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

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: { StepAutoCompleted: 'auto' },
}));

jest.mock('./step-analytics', () => ({
  buildStepEventProperties: jest.fn((props) => props),
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
    const rendered = screen.getAllByRole('button').filter((b) => b.textContent?.match(/^(Alpha|Bravo|Charlie|Delta)$/));
    expect(rendered.map((b) => b.textContent)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);
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
      const rendered = screen
        .getAllByRole('button')
        .filter((b) => b.textContent?.match(/^(Alpha|Bravo|Charlie|Delta)$/));
      const orderChanged = rendered.some((b, i) => b.textContent !== choices[i]!.text);
      expect(orderChanged).toBe(true);
      // All four choices still present.
      expect(new Set(rendered.map((b) => b.textContent))).toEqual(new Set(['Alpha', 'Bravo', 'Charlie', 'Delta']));
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
        const rendered = screen
          .getAllByRole('button')
          .filter((b) => b.textContent?.match(/^(Alpha|Bravo|Charlie|All of the above)$/));
        expect(rendered[rendered.length - 1]!.textContent).toBe('All of the above');
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

      // Find the rendered "Bravo" button (correct=true) — its visual position
      // is whatever the shuffle produced; we look up by text.
      const correctButton = screen.getByRole('button', { name: 'Bravo' });
      fireEvent.click(correctButton);
      fireEvent.click(screen.getByRole('button', { name: /Check Answer/i }));

      expect(screen.getByText(/Correct! Well done\./i)).toBeInTheDocument();
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
      fireEvent.click(screen.getByRole('button', { name: 'Charlie' }));
      fireEvent.click(screen.getByRole('button', { name: /Check Answer/i }));
      expect(screen.getByText('Charlie hint')).toBeInTheDocument();
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

  const readChoiceOrder = () =>
    screen
      .getAllByRole('button')
      .map((b) => b.textContent)
      .filter((t): t is string => !!t && /^(Alpha|Bravo|Charlie|Delta)$/.test(t));

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
      fireEvent.click(screen.getByRole('button', { name: 'Bravo' }));
      fireEvent.click(screen.getByRole('button', { name: /Check Answer/i }));
      expect(screen.getByText(/Correct! Well done\./i)).toBeInTheDocument();

      // Force a parent re-render with an unrelated prop change (and a fresh choices reference).
      rerender(
        <InteractiveQuiz question="Q (edited)" choices={[...choices]} shuffle={true}>
          Q (edited)
        </InteractiveQuiz>
      );

      // Completion message still shown.
      expect(screen.getByText(/Correct! Well done\./i)).toBeInTheDocument();
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
      const orderBefore = screen
        .getAllByRole('button')
        .map((b) => b.textContent)
        .filter((t): t is string => !!t && /^(Alpha|Bravo|Charlie)$/.test(t));

      // Pick a wrong answer so the hint surfaces.
      fireEvent.click(screen.getByRole('button', { name: 'Charlie' }));
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
      const orderAfter = screen
        .getAllByRole('button')
        .map((b) => b.textContent)
        .filter((t): t is string => !!t && /^(Alpha|Bravo|Charlie)$/.test(t));
      expect(orderAfter).toEqual(orderBefore);
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

  it('writes reason="manual" to the store when the user answers correctly', () => {
    render(
      <InteractiveQuiz question="Q" choices={choices} shuffle={false} stepId="quiz-correct-test">
        Q
      </InteractiveQuiz>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Bravo' }));
    fireEvent.click(screen.getByRole('button', { name: /Check Answer/i }));

    const store = require('../../global-state/completion-store') as {
      __getStoredReason: (stepId: string) => string | null;
    };
    expect(store.__getStoredReason('quiz-correct-test')).toBe('manual');
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
