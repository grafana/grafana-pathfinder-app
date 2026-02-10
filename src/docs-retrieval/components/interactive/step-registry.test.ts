/**
 * Unit tests for step-registry.ts
 *
 * Lifecycle: **permanent** — These tests provide long-term coverage for the
 * extracted step registry module.
 */

import {
  resetStepRegistry,
  nextSectionCounter,
  registerSectionSteps,
  getTotalDocumentSteps,
  getDocumentStepPosition,
} from './step-registry';

// Mock the child step counter resets (we don't need their real implementations)
jest.mock('./interactive-step', () => ({ resetStepCounter: jest.fn() }));
jest.mock('./interactive-multi-step', () => ({ resetMultiStepCounter: jest.fn() }));
jest.mock('./interactive-guided', () => ({ resetGuidedCounter: jest.fn() }));
jest.mock('./interactive-quiz', () => ({ resetQuizCounter: jest.fn() }));

beforeEach(() => {
  resetStepRegistry();
});

// ---------------------------------------------------------------------------
// resetStepRegistry
// ---------------------------------------------------------------------------

describe('resetStepRegistry', () => {
  it('resets totalDocumentSteps to 0', () => {
    registerSectionSteps('section-a', 5);
    expect(getTotalDocumentSteps()).toBe(5);

    resetStepRegistry();
    expect(getTotalDocumentSteps()).toBe(0);
  });

  it('resets section counter', () => {
    // Consume a couple of counter values
    nextSectionCounter();
    nextSectionCounter();

    resetStepRegistry();
    // After reset, counter should start from 1 again
    expect(nextSectionCounter()).toBe(1);
  });

  it('clears all registered sections', () => {
    registerSectionSteps('section-a', 3);
    registerSectionSteps('section-b', 2);

    resetStepRegistry();

    // After reset, registering a new section should start fresh
    const result = registerSectionSteps('section-c', 4);
    expect(result).toEqual({ offset: 0, total: 4 });
  });

  it('calls child step counter resets', () => {
    const { resetStepCounter } = require('./interactive-step');
    const { resetMultiStepCounter } = require('./interactive-multi-step');
    const { resetGuidedCounter } = require('./interactive-guided');
    const { resetQuizCounter } = require('./interactive-quiz');

    resetStepRegistry();

    expect(resetStepCounter).toHaveBeenCalled();
    expect(resetMultiStepCounter).toHaveBeenCalled();
    expect(resetGuidedCounter).toHaveBeenCalled();
    expect(resetQuizCounter).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// nextSectionCounter
// ---------------------------------------------------------------------------

describe('nextSectionCounter', () => {
  it('returns incrementing values starting from 1', () => {
    expect(nextSectionCounter()).toBe(1);
    expect(nextSectionCounter()).toBe(2);
    expect(nextSectionCounter()).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// registerSectionSteps
// ---------------------------------------------------------------------------

describe('registerSectionSteps', () => {
  it('registers a single section and returns correct offset and total', () => {
    const result = registerSectionSteps('section-a', 5);
    expect(result).toEqual({ offset: 0, total: 5 });
  });

  it('registers multiple sections with correct cumulative offsets', () => {
    registerSectionSteps('section-a', 3, 0);
    const result = registerSectionSteps('section-b', 4, 1);
    expect(result).toEqual({ offset: 3, total: 7 });
  });

  it('preserves document order when re-registering with updated step count', () => {
    // Pre-register in document order
    registerSectionSteps('section-a', 0, 0);
    registerSectionSteps('section-b', 0, 1);

    // Re-register with actual step counts (order should be preserved)
    registerSectionSteps('section-a', 3);
    const result = registerSectionSteps('section-b', 4);

    expect(result).toEqual({ offset: 3, total: 7 });
  });

  it('uses auto-incrementing order when no explicit order is provided', () => {
    // Register without explicit order — should use insertion order
    registerSectionSteps('section-a', 3);
    registerSectionSteps('section-b', 2);

    const posA = getDocumentStepPosition('section-a', 0);
    const posB = getDocumentStepPosition('section-b', 0);

    // section-a was registered first, so its offset should be 0
    expect(posA.stepIndex).toBe(0);
    // section-b should start after section-a's 3 steps
    expect(posB.stepIndex).toBe(3);
  });

  it('sorts by explicit documentOrder regardless of registration order', () => {
    // Register in reverse order but with explicit documentOrder
    registerSectionSteps('section-b', 4, 1);
    registerSectionSteps('section-a', 3, 0);

    const posA = getDocumentStepPosition('section-a', 0);
    const posB = getDocumentStepPosition('section-b', 0);

    // section-a has documentOrder 0, so it should come first
    expect(posA.stepIndex).toBe(0);
    expect(posB.stepIndex).toBe(3);
  });

  it('is idempotent when called with same sectionId and count', () => {
    registerSectionSteps('section-a', 3, 0);
    registerSectionSteps('section-a', 3, 0);

    expect(getTotalDocumentSteps()).toBe(3);
  });

  it('handles zero-step pre-registration followed by a non-zero section', () => {
    // Pre-register a zero-step section (e.g. placeholder before children render)
    const zeroResult = registerSectionSteps('section-a', 0, 0);
    expect(zeroResult.offset).toBe(0);

    // Register a non-zero section after
    const nonZeroResult = registerSectionSteps('section-b', 5, 1);

    // Zero-step section contributes nothing, so section-b also starts at offset 0
    expect(nonZeroResult.offset).toBe(0);
    expect(getTotalDocumentSteps()).toBe(5);

    // Verify the zero-step section's offset is still 0
    const posA = getDocumentStepPosition('section-a', 0);
    expect(posA.stepIndex).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getTotalDocumentSteps
// ---------------------------------------------------------------------------

describe('getTotalDocumentSteps', () => {
  it('returns 0 when no sections are registered', () => {
    expect(getTotalDocumentSteps()).toBe(0);
  });

  it('returns sum of all registered step counts', () => {
    registerSectionSteps('section-a', 3, 0);
    registerSectionSteps('section-b', 4, 1);
    registerSectionSteps('section-c', 2, 2);

    expect(getTotalDocumentSteps()).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// getDocumentStepPosition
// ---------------------------------------------------------------------------

describe('getDocumentStepPosition', () => {
  it('returns correct position for first step in first section', () => {
    registerSectionSteps('section-a', 3, 0);
    registerSectionSteps('section-b', 4, 1);

    const result = getDocumentStepPosition('section-a', 0);
    expect(result).toEqual({ stepIndex: 0, totalSteps: 7 });
  });

  it('returns correct position for middle step in first section', () => {
    registerSectionSteps('section-a', 3, 0);
    registerSectionSteps('section-b', 4, 1);

    const result = getDocumentStepPosition('section-a', 2);
    expect(result).toEqual({ stepIndex: 2, totalSteps: 7 });
  });

  it('returns correct position for first step in second section', () => {
    registerSectionSteps('section-a', 3, 0);
    registerSectionSteps('section-b', 4, 1);

    const result = getDocumentStepPosition('section-b', 0);
    expect(result).toEqual({ stepIndex: 3, totalSteps: 7 });
  });

  it('returns offset 0 for unknown section', () => {
    registerSectionSteps('section-a', 3, 0);

    const result = getDocumentStepPosition('unknown', 0);
    expect(result).toEqual({ stepIndex: 0, totalSteps: 3 });
  });
});
