import GlobalInteractionBlocker from './global-interaction-blocker';
import { InteractiveElementData } from '../types/interactive.types';

describe('GlobalInteractionBlocker', () => {
  let blocker: GlobalInteractionBlocker;
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
    blocker = GlobalInteractionBlocker.getInstance();
    // Clean up any existing state
    blocker.forceUnblock();
  });

  afterEach(() => {
    // Clean up after each test
    blocker.forceUnblock();
    // Remove any overlay elements
    const overlay = document.getElementById('interactive-blocking-overlay');
    if (overlay) {
      overlay.remove();
    }
  });

  test('should be a singleton', () => {
    const blocker1 = GlobalInteractionBlocker.getInstance();
    const blocker2 = GlobalInteractionBlocker.getInstance();
    expect(blocker1).toBe(blocker2);
  });

  test('should start and stop section blocking correctly', () => {
    expect(blocker.isSectionBlocking()).toBe(false);
    
    blocker.startSectionBlocking('test-section', mockData);
    expect(blocker.isSectionBlocking()).toBe(true);
    
    blocker.stopSectionBlocking('test-section');
    expect(blocker.isSectionBlocking()).toBe(false);
  });

  test('should handle multiple section blocking requests (only one active at a time)', () => {
    blocker.startSectionBlocking('section1', mockData);
    expect(blocker.isSectionBlocking()).toBe(true);
    
    // Second request should be ignored (logged but not change state)
    blocker.startSectionBlocking('section2', mockData);
    expect(blocker.isSectionBlocking()).toBe(true);
    
    // Stopping first section should work
    blocker.stopSectionBlocking('section1');
    expect(blocker.isSectionBlocking()).toBe(false);
  });

  test('should create blocking overlay when starting section', () => {
    blocker.startSectionBlocking('test-section', mockData);
    
    const overlay = document.getElementById('interactive-blocking-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay?.style.position).toBe('fixed');
  });

  test('should remove blocking overlay when stopping section', () => {
    blocker.startSectionBlocking('test-section', mockData);
    let overlay = document.getElementById('interactive-blocking-overlay');
    expect(overlay).toBeTruthy();
    
    blocker.stopSectionBlocking('test-section');
    overlay = document.getElementById('interactive-blocking-overlay');
    expect(overlay).toBeFalsy();
  });

  test('should force unblock section', () => {
    blocker.startSectionBlocking('test-section', mockData);
    
    expect(blocker.isSectionBlocking()).toBe(true);
    
    blocker.forceUnblock();
    
    expect(blocker.isSectionBlocking()).toBe(false);
    
    const overlay = document.getElementById('interactive-blocking-overlay');
    expect(overlay).toBeFalsy();
  });
});
