/**
 * Unit Tests for Guide Test Runner
 *
 * These tests provide a safety net for the guide-runner module refactoring.
 * They cover pure functions and console output functions.
 *
 * @see tests/e2e-runner/utils/guide-runner/
 */

// Mock @playwright/test before any imports that use it
jest.mock('@playwright/test', () => ({
  Page: jest.fn(),
  Locator: jest.fn(),
  expect: jest.fn(),
  test: jest.fn(),
}));

import {
  calculateStepTimeout,
  summarizeResults,
  logStepResult,
  logExecutionSummary,
  DEFAULT_STEP_TIMEOUT_MS,
  TIMEOUT_PER_MULTISTEP_ACTION_MS,
  TIMEOUT_PER_GUIDED_SUBSTEP_MS,
} from './guide-runner';
import type { StepTestResult, TestableStep } from './guide-runner';

// ============================================
// Test Fixtures
// ============================================

/**
 * Create a minimal TestableStep for testing.
 * Only includes fields required by the functions under test.
 */
function createTestableStep(overrides: Partial<TestableStep> = {}): TestableStep {
  return {
    stepId: 'test-step-1',
    index: 0,
    skippable: false,
    hasDoItButton: true,
    isPreCompleted: false,
    isMultistep: false,
    internalActionCount: 0,
    isGuided: false,
    locator: {} as unknown as TestableStep['locator'], // Mock locator - not used in pure functions
    ...overrides,
  };
}

/**
 * Create a minimal StepTestResult for testing.
 */
function createStepResult(overrides: Partial<StepTestResult> = {}): StepTestResult {
  return {
    stepId: 'test-step-1',
    status: 'passed',
    durationMs: 100,
    currentUrl: 'http://localhost:3000/',
    consoleErrors: [],
    skippable: false,
    ...overrides,
  };
}

// ============================================
// calculateStepTimeout Tests
// ============================================

describe('calculateStepTimeout', () => {
  it('returns default timeout for non-multistep', () => {
    const step = createTestableStep({ isMultistep: false });

    const timeout = calculateStepTimeout(step);

    expect(timeout).toBe(DEFAULT_STEP_TIMEOUT_MS);
  });

  it('returns default timeout for multistep with zero internal actions', () => {
    const step = createTestableStep({
      isMultistep: true,
      internalActionCount: 0,
    });

    const timeout = calculateStepTimeout(step);

    expect(timeout).toBe(DEFAULT_STEP_TIMEOUT_MS);
  });

  it('adds time per internal action for multisteps', () => {
    const step = createTestableStep({
      isMultistep: true,
      internalActionCount: 3,
    });

    const timeout = calculateStepTimeout(step);

    // 30s base + 3 * 5s = 45s
    expect(timeout).toBe(DEFAULT_STEP_TIMEOUT_MS + 3 * TIMEOUT_PER_MULTISTEP_ACTION_MS);
  });

  it('scales linearly with internal action count', () => {
    const step1 = createTestableStep({ isMultistep: true, internalActionCount: 1 });
    const step5 = createTestableStep({ isMultistep: true, internalActionCount: 5 });
    const step10 = createTestableStep({ isMultistep: true, internalActionCount: 10 });

    const timeout1 = calculateStepTimeout(step1);
    const timeout5 = calculateStepTimeout(step5);
    const timeout10 = calculateStepTimeout(step10);

    // Verify linear scaling
    expect(timeout5 - timeout1).toBe(4 * TIMEOUT_PER_MULTISTEP_ACTION_MS);
    expect(timeout10 - timeout5).toBe(5 * TIMEOUT_PER_MULTISTEP_ACTION_MS);

    // Verify absolute values
    expect(timeout1).toBe(DEFAULT_STEP_TIMEOUT_MS + 1 * TIMEOUT_PER_MULTISTEP_ACTION_MS); // 35s
    expect(timeout5).toBe(DEFAULT_STEP_TIMEOUT_MS + 5 * TIMEOUT_PER_MULTISTEP_ACTION_MS); // 55s
    expect(timeout10).toBe(DEFAULT_STEP_TIMEOUT_MS + 10 * TIMEOUT_PER_MULTISTEP_ACTION_MS); // 80s
  });

  it('ignores isMultistep=false even with non-zero internalActionCount', () => {
    // Edge case: internalActionCount set but isMultistep is false
    const step = createTestableStep({
      isMultistep: false,
      internalActionCount: 5,
    });

    const timeout = calculateStepTimeout(step);

    // Should use default timeout since isMultistep is false
    expect(timeout).toBe(DEFAULT_STEP_TIMEOUT_MS);
  });

  it('adds time per guided substep when isGuided and guidedStepCount > 0', () => {
    const step = createTestableStep({
      isGuided: true,
      guidedStepCount: 3,
    });

    const timeout = calculateStepTimeout(step);

    expect(timeout).toBe(DEFAULT_STEP_TIMEOUT_MS + 3 * TIMEOUT_PER_GUIDED_SUBSTEP_MS);
  });

  it('returns default timeout for guided step with zero guidedStepCount', () => {
    const step = createTestableStep({
      isGuided: true,
      guidedStepCount: 0,
    });

    const timeout = calculateStepTimeout(step);

    expect(timeout).toBe(DEFAULT_STEP_TIMEOUT_MS);
  });

  it('returns default timeout for guided step with undefined guidedStepCount', () => {
    const step = createTestableStep({
      isGuided: true,
      guidedStepCount: undefined,
    });

    const timeout = calculateStepTimeout(step);

    expect(timeout).toBe(DEFAULT_STEP_TIMEOUT_MS);
  });

  it('prefers guided timeout over multistep when both set', () => {
    const step = createTestableStep({
      isMultistep: true,
      internalActionCount: 2,
      isGuided: true,
      guidedStepCount: 4,
    });

    const timeout = calculateStepTimeout(step);

    expect(timeout).toBe(DEFAULT_STEP_TIMEOUT_MS + 4 * TIMEOUT_PER_GUIDED_SUBSTEP_MS);
  });
});

// ============================================
// summarizeResults Tests
// ============================================

describe('summarizeResults', () => {
  it('returns zeros for empty results array', () => {
    const summary = summarizeResults([]);

    expect(summary).toEqual({
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      notReached: 0,
      mandatoryFailed: 0,
      skippableFailed: 0,
      success: true,
      totalDurationMs: 0,
    });
  });

  it('counts passed results correctly', () => {
    const results = [
      createStepResult({ stepId: 'step-1', status: 'passed', durationMs: 100 }),
      createStepResult({ stepId: 'step-2', status: 'passed', durationMs: 200 }),
      createStepResult({ stepId: 'step-3', status: 'passed', durationMs: 300 }),
    ];

    const summary = summarizeResults(results);

    expect(summary.total).toBe(3);
    expect(summary.passed).toBe(3);
    expect(summary.failed).toBe(0);
    expect(summary.success).toBe(true);
    expect(summary.totalDurationMs).toBe(600);
  });

  it('counts skipped results correctly', () => {
    const results = [
      createStepResult({ stepId: 'step-1', status: 'passed' }),
      createStepResult({ stepId: 'step-2', status: 'skipped', skipReason: 'pre_completed' }),
      createStepResult({ stepId: 'step-3', status: 'skipped', skipReason: 'no_do_it_button' }),
    ];

    const summary = summarizeResults(results);

    expect(summary.passed).toBe(1);
    expect(summary.skipped).toBe(2);
    expect(summary.success).toBe(true);
  });

  it('counts not_reached results correctly', () => {
    const results = [
      createStepResult({ stepId: 'step-1', status: 'passed' }),
      createStepResult({ stepId: 'step-2', status: 'failed', skippable: false }),
      createStepResult({ stepId: 'step-3', status: 'not_reached' }),
      createStepResult({ stepId: 'step-4', status: 'not_reached' }),
    ];

    const summary = summarizeResults(results);

    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.notReached).toBe(2);
    expect(summary.success).toBe(false);
  });

  it('distinguishes mandatory vs skippable failures', () => {
    const results = [
      createStepResult({ stepId: 'step-1', status: 'failed', skippable: false }),
      createStepResult({ stepId: 'step-2', status: 'failed', skippable: true }),
      createStepResult({ stepId: 'step-3', status: 'failed', skippable: true }),
    ];

    const summary = summarizeResults(results);

    expect(summary.failed).toBe(3);
    expect(summary.mandatoryFailed).toBe(1);
    expect(summary.skippableFailed).toBe(2);
  });

  it('success is true when only skippable steps fail', () => {
    const results = [
      createStepResult({ stepId: 'step-1', status: 'passed' }),
      createStepResult({ stepId: 'step-2', status: 'failed', skippable: true }),
      createStepResult({ stepId: 'step-3', status: 'passed' }),
    ];

    const summary = summarizeResults(results);

    expect(summary.success).toBe(true);
    expect(summary.failed).toBe(1);
    expect(summary.skippableFailed).toBe(1);
    expect(summary.mandatoryFailed).toBe(0);
  });

  it('success is false when any mandatory step fails', () => {
    const results = [
      createStepResult({ stepId: 'step-1', status: 'passed' }),
      createStepResult({ stepId: 'step-2', status: 'failed', skippable: false }),
      createStepResult({ stepId: 'step-3', status: 'failed', skippable: true }),
    ];

    const summary = summarizeResults(results);

    expect(summary.success).toBe(false);
    expect(summary.mandatoryFailed).toBe(1);
    expect(summary.skippableFailed).toBe(1);
  });

  it('sums duration across all results', () => {
    const results = [
      createStepResult({ stepId: 'step-1', durationMs: 1000 }),
      createStepResult({ stepId: 'step-2', durationMs: 2500 }),
      createStepResult({ stepId: 'step-3', durationMs: 500 }),
    ];

    const summary = summarizeResults(results);

    expect(summary.totalDurationMs).toBe(4000);
  });

  it('handles mixed status results correctly', () => {
    const results = [
      createStepResult({ stepId: 'step-1', status: 'passed', durationMs: 100 }),
      createStepResult({ stepId: 'step-2', status: 'skipped', durationMs: 50 }),
      createStepResult({ stepId: 'step-3', status: 'failed', skippable: true, durationMs: 200 }),
      createStepResult({ stepId: 'step-4', status: 'not_reached', durationMs: 0 }),
    ];

    const summary = summarizeResults(results);

    expect(summary).toEqual({
      total: 4,
      passed: 1,
      failed: 1,
      skipped: 1,
      notReached: 1,
      mandatoryFailed: 0,
      skippableFailed: 1,
      success: true, // Only skippable failed, so success
      totalDurationMs: 350,
    });
  });
});

// ============================================
// logStepResult Tests
// ============================================

describe('logStepResult', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('logs passed step with checkmark icon', () => {
    const result = createStepResult({
      stepId: 'my-step',
      status: 'passed',
      durationMs: 150,
    });

    logStepResult(result);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('✓'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('my-step'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('passed'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('150ms'));
  });

  it('logs failed step with X icon and FAILED status', () => {
    const result = createStepResult({
      stepId: 'fail-step',
      status: 'failed',
      durationMs: 500,
      skippable: false,
    });

    logStepResult(result);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('✗'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('FAILED'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('mandatory - test stops'));
  });

  it('logs skipped step with empty-set icon', () => {
    const result = createStepResult({
      stepId: 'skip-step',
      status: 'skipped',
      skipReason: 'pre_completed',
    });

    logStepResult(result);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('⊘'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('skipped'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[pre_completed]'));
  });

  it('logs not_reached step with circle icon', () => {
    const result = createStepResult({
      stepId: 'unreached-step',
      status: 'not_reached',
    });

    logStepResult(result);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('○'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('not reached'));
  });

  it('indicates skippable for failed steps', () => {
    const result = createStepResult({
      stepId: 'skip-fail',
      status: 'failed',
      skippable: true,
    });

    logStepResult(result);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('skippable - test continues'));
  });

  it('indicates mandatory for failed steps', () => {
    const result = createStepResult({
      stepId: 'mandatory-fail',
      status: 'failed',
      skippable: false,
    });

    logStepResult(result);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('mandatory - test stops'));
  });

  it('includes error message when present', () => {
    const result = createStepResult({
      stepId: 'error-step',
      status: 'failed',
      error: 'Element not found: button#submit',
      skippable: false,
    });

    logStepResult(result);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error: Element not found'));
  });

  it('includes console error count when present', () => {
    const result = createStepResult({
      stepId: 'console-errors',
      status: 'passed',
      consoleErrors: ['Error 1', 'Error 2', 'Error 3'],
    });

    logStepResult(result);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Console errors: 3'));
  });

  it('includes skip reason when present', () => {
    const result = createStepResult({
      stepId: 'skip-reason-step',
      status: 'skipped',
      skipReason: 'requirements_unmet',
    });

    logStepResult(result);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[requirements_unmet]'));
  });
});

// ============================================
// logExecutionSummary Tests
// ============================================

describe('logExecutionSummary', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('logs summary header', () => {
    logExecutionSummary([]);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Execution Summary'));
  });

  it('logs total steps count', () => {
    const results = [createStepResult({ stepId: 'step-1' }), createStepResult({ stepId: 'step-2' })];

    logExecutionSummary(results);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Total steps: 2'));
  });

  it('logs passed count with checkmark', () => {
    const results = [
      createStepResult({ stepId: 'step-1', status: 'passed' }),
      createStepResult({ stepId: 'step-2', status: 'passed' }),
    ];

    logExecutionSummary(results);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('✓ Passed: 2'));
  });

  it('logs failed count with X when failures exist', () => {
    const results = [
      createStepResult({ stepId: 'step-1', status: 'passed' }),
      createStepResult({ stepId: 'step-2', status: 'failed', skippable: false }),
    ];

    logExecutionSummary(results);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('✗ Failed: 1'));
  });

  it('logs breakdown of mandatory vs skippable failures', () => {
    const results = [
      createStepResult({ stepId: 'step-1', status: 'failed', skippable: false }),
      createStepResult({ stepId: 'step-2', status: 'failed', skippable: true }),
      createStepResult({ stepId: 'step-3', status: 'failed', skippable: true }),
    ];

    logExecutionSummary(results);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Mandatory: 1'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Skippable: 2'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('affects result'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('does not affect result'));
  });

  it('logs skipped count', () => {
    const results = [createStepResult({ stepId: 'step-1', status: 'skipped' })];

    logExecutionSummary(results);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('⊘ Skipped: 1'));
  });

  it('logs not reached count', () => {
    const results = [
      createStepResult({ stepId: 'step-1', status: 'not_reached' }),
      createStepResult({ stepId: 'step-2', status: 'not_reached' }),
    ];

    logExecutionSummary(results);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('○ Not reached: 2'));
  });

  it('logs total duration', () => {
    const results = [
      createStepResult({ stepId: 'step-1', durationMs: 1000 }),
      createStepResult({ stepId: 'step-2', durationMs: 2000 }),
    ];

    logExecutionSummary(results);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Total duration: 3000ms'));
  });

  it('logs SUCCESS when no mandatory failures', () => {
    const results = [
      createStepResult({ stepId: 'step-1', status: 'passed' }),
      createStepResult({ stepId: 'step-2', status: 'failed', skippable: true }),
    ];

    logExecutionSummary(results);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('✅ SUCCESS'));
  });

  it('logs FAILURE when mandatory failure exists', () => {
    const results = [
      createStepResult({ stepId: 'step-1', status: 'passed' }),
      createStepResult({ stepId: 'step-2', status: 'failed', skippable: false }),
    ];

    logExecutionSummary(results);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('❌ FAILURE'));
  });

  it('logs Failed: 0 when no failures', () => {
    const results = [createStepResult({ stepId: 'step-1', status: 'passed' })];

    logExecutionSummary(results);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('✗ Failed: 0'));
  });
});
