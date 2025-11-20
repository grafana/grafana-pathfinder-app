import { SequentialRequirementsManager } from './index';
import { ContextService } from '../context-engine';

describe('SequentialRequirementsManager DOM monitoring (nav)', () => {
  it('no longer triggers recheck on nav mutations (uses context monitoring instead)', async () => {
    const manager = SequentialRequirementsManager.getInstance();
    const spy = jest.spyOn<any, any>(manager as any, 'triggerSelectiveRecheck');

    manager.startDOMMonitoring();

    const nav = document.createElement('nav');
    nav.setAttribute('aria-label', 'Navigation');
    document.body.appendChild(nav);

    // Simulate attribute mutation
    nav.setAttribute('aria-expanded', 'false');

    // Wait for potential recheck
    await new Promise((resolve) => setTimeout(resolve, 1600));

    // Should NOT be called - nav monitoring now uses context service instead
    expect(spy).not.toHaveBeenCalled();

    manager.stopDOMMonitoring();
  });
});

describe('SequentialRequirementsManager', () => {
  beforeEach(() => {
    // Reset singleton instance between tests
    // @ts-ignore - accessing private static for testing
    SequentialRequirementsManager.instance = undefined;
  });

  it('should maintain singleton instance', () => {
    const instance1 = SequentialRequirementsManager.getInstance();
    const instance2 = SequentialRequirementsManager.getInstance();
    expect(instance1).toBe(instance2);
  });

  it('should manage step registration and updates', () => {
    const manager = SequentialRequirementsManager.getInstance();

    manager.registerStep('step-1', false);
    expect(manager.getStepState('step-1')).toEqual({
      isEnabled: false,
      isCompleted: false,
      isChecking: false,
    });

    manager.updateStep('step-1', { isEnabled: true });
    expect(manager.getStepState('step-1')?.isEnabled).toBe(true);
  });

  it('should handle DOM monitoring', () => {
    const manager = SequentialRequirementsManager.getInstance();

    // Start monitoring
    manager.startDOMMonitoring();
    expect(manager['domObserver']).toBeDefined();
    expect(manager['navigationUnlisten']).toBeDefined();

    // Stop monitoring
    manager.stopDOMMonitoring();
    expect(manager['domObserver']).toBeUndefined();
    expect(manager['navigationUnlisten']).toBeUndefined();
  });

  it('rechecks incomplete steps when context changes', async () => {
    const manager = SequentialRequirementsManager.getInstance();

    const step1 = 'test-step-1';
    const step2 = 'test-step-2';

    manager.registerStep(step1, false);
    manager.registerStep(step2, false);

    // Mark step 1 complete
    manager.updateStep(step1, { isCompleted: true });

    const checker1 = jest.fn();
    const checker2 = jest.fn();

    manager.registerStepCheckerByID(step1, checker1);
    manager.registerStepCheckerByID(step2, checker2);

    // Trigger context change
    manager.recheckNextSteps();

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Step 1 already complete, shouldn't recheck
    expect(checker1).not.toHaveBeenCalled();

    // Step 2 incomplete, should recheck
    expect(checker2).toHaveBeenCalled();
  });

  it('debounces rapid context changes', () => {
    const manager = SequentialRequirementsManager.getInstance();
    const step = 'test-step';

    manager.registerStep(step, false);

    const checker = jest.fn();
    manager.registerStepCheckerByID(step, checker);

    // Store initial time
    const initialTime = manager['lastContextChangeTime'];

    // Rapid calls within 500ms
    manager.recheckNextSteps();
    const firstCallTime = manager['lastContextChangeTime'];
    expect(firstCallTime).toBeGreaterThan(initialTime);

    manager.recheckNextSteps();
    manager.recheckNextSteps();

    // Should debounce - time shouldn't change
    expect(manager['lastContextChangeTime']).toBe(firstCallTime);
  });

  it('starts and stops context monitoring', () => {
    const manager = SequentialRequirementsManager.getInstance();

    // Start context monitoring
    manager.startContextMonitoring();
    // Should be set after async import completes, but we can't easily test that
    // Just verify it doesn't throw
    expect(() => manager.startContextMonitoring()).not.toThrow();

    // Stop context monitoring
    manager.stopContextMonitoring();
    expect(manager['contextChangeUnsubscribe']).toBeUndefined();
  });

  it('clears context-recheck timeout on stop', () => {
    const manager = SequentialRequirementsManager.getInstance();

    manager.startDOMMonitoring();
    manager.stopDOMMonitoring();

    // Verify context monitoring is stopped
    expect(manager['contextChangeUnsubscribe']).toBeUndefined();
  });
});

describe('SequentialRequirementsManager context integration', () => {
  beforeEach(() => {
    // Reset singleton instance between tests
    // @ts-ignore - accessing private static for testing
    SequentialRequirementsManager.instance = undefined;
  });

  it('notifies listeners when context changes', () => {
    const listener = jest.fn();
    const unsubscribe = ContextService.onContextChange(listener);

    // Simulate EchoSrv event triggering context change
    // Access private method for testing
    (ContextService as any).notifyContextChange();

    expect(listener).toHaveBeenCalled();

    unsubscribe();
  });

  it('integrates context monitoring with requirements manager', async () => {
    const manager = SequentialRequirementsManager.getInstance();
    const step = 'test-step';

    manager.registerStep(step, false);

    const checker = jest.fn();
    manager.registerStepCheckerByID(step, checker);

    // Start monitoring which subscribes to context changes
    manager.startDOMMonitoring();

    // Wait for async import to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Trigger context change
    (ContextService as any).notifyContextChange();

    // Wait for debounce and execution
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Checker should have been called
    expect(checker).toHaveBeenCalled();

    manager.stopDOMMonitoring();
  });
});
