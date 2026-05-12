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
  buildInteractiveStepProperties: jest.fn((props) => props),
}));

jest.mock('./use-standalone-persistence', () => ({
  useStandalonePersistence: jest.fn(),
}));

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
