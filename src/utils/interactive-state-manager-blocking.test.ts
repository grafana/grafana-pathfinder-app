import { InteractiveStateManager } from './interactive-state-manager';
import { InteractiveElementData } from '../types/interactive.types';

describe('InteractiveStateManager - Section Blocking Integration', () => {
  let stateManager: InteractiveStateManager;
  const mockData: InteractiveElementData = {
    reftarget: '.test-button',
    targetaction: 'button',
    targetvalue: undefined,
    requirements: undefined,
    tagName: 'button',
    textContent: 'Test Button',
    timestamp: Date.now(),
  };

  beforeEach(() => {
    stateManager = new InteractiveStateManager({
      enableGlobalBlocking: true,
      enableLogging: false, // Reduce noise in tests
    });
    stateManager.forceUnblock(); // Clean slate
  });

  afterEach(() => {
    stateManager.forceUnblock();
    // Clean up overlay
    const overlay = document.getElementById('interactive-blocking-overlay');
    if (overlay) {
      overlay.remove();
    }
  });

  test('should start section blocking', () => {
    expect(stateManager.isSectionBlocking()).toBe(false);

    stateManager.startSectionBlocking('test-section', mockData);

    expect(stateManager.isSectionBlocking()).toBe(true);
  });

  test('should stop section blocking', () => {
    stateManager.startSectionBlocking('test-section', mockData);
    expect(stateManager.isSectionBlocking()).toBe(true);

    stateManager.stopSectionBlocking('test-section');

    expect(stateManager.isSectionBlocking()).toBe(false);
  });

  test('should handle setState without blocking interference', async () => {
    // setState should work normally without any blocking side effects
    await stateManager.setState(mockData, 'running');
    await stateManager.setState(mockData, 'completed');
    await stateManager.setState(mockData, 'error');

    // No exceptions should be thrown
    expect(true).toBe(true);
  });

  test('should not start section blocking when enableGlobalBlocking is false', () => {
    const stateManagerNoBlocking = new InteractiveStateManager({
      enableGlobalBlocking: false,
      enableLogging: false,
    });

    expect(stateManagerNoBlocking.isSectionBlocking()).toBe(false);

    stateManagerNoBlocking.startSectionBlocking('test-section', mockData);

    // Should still be false because global blocking is disabled
    expect(stateManagerNoBlocking.isSectionBlocking()).toBe(false);
  });

  test('should handle error without affecting section blocking', () => {
    stateManager.startSectionBlocking('test-section', mockData);
    expect(stateManager.isSectionBlocking()).toBe(true);

    expect(() => {
      stateManager.handleError('Test error', 'test context', mockData, false);
    }).not.toThrow();

    // Section blocking should be unaffected by error handling
    expect(stateManager.isSectionBlocking()).toBe(true);
  });

  test('should force unblock section blocking', () => {
    stateManager.startSectionBlocking('test-section', mockData);
    expect(stateManager.isSectionBlocking()).toBe(true);

    stateManager.forceUnblock();

    expect(stateManager.isSectionBlocking()).toBe(false);
  });
});
