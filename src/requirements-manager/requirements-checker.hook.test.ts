import { SequentialRequirementsManager } from './index';

describe('SequentialRequirementsManager DOM monitoring (nav)', () => {
  it('triggers selective recheck on nav-related mutations', async () => {
    const manager = SequentialRequirementsManager.getInstance();
    const spy = jest.spyOn<any, any>(manager as any, 'triggerSelectiveRecheck');

    manager.startDOMMonitoring();

    const nav = document.createElement('nav');
    nav.setAttribute('aria-label', 'Navigation');
    document.body.appendChild(nav);

    // Simulate attribute mutation
    nav.setAttribute('aria-expanded', 'false');

    // Debounced - wait for 1200ms debounce + 300ms settling delay + buffer
    await new Promise((resolve) => setTimeout(resolve, 1600));

    expect(spy).toHaveBeenCalled();

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
});
