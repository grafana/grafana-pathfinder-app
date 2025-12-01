import GlobalInteractionBlocker from './global-interaction-blocker';
import { InteractiveElementData } from '../types/interactive.types';
import { TimeoutManager } from '../utils/timeout-manager';

// Mock TimeoutManager
jest.mock('../utils/timeout-manager', () => ({
  TimeoutManager: {
    getInstance: jest.fn().mockReturnValue({
      setInterval: jest.fn(),
      clearInterval: jest.fn(),
    }),
  },
}));

describe('GlobalInteractionBlocker', () => {
  let blocker: GlobalInteractionBlocker;
  let mockTimeoutManager: jest.Mocked<ReturnType<typeof TimeoutManager.getInstance>>;

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
    jest.clearAllMocks();
    mockTimeoutManager = TimeoutManager.getInstance() as jest.Mocked<ReturnType<typeof TimeoutManager.getInstance>>;
    blocker = GlobalInteractionBlocker.getInstance();
    // Clean up any existing state
    blocker.forceUnblock();
  });

  afterEach(() => {
    // Clean up after each test
    blocker.forceUnblock();
    // Remove any overlay elements
    document.querySelectorAll('[id*="interactive-"]').forEach((el) => el.remove());
  });

  describe('singleton pattern', () => {
    test('should be a singleton', () => {
      const blocker1 = GlobalInteractionBlocker.getInstance();
      const blocker2 = GlobalInteractionBlocker.getInstance();
      expect(blocker1).toBe(blocker2);
    });
  });

  describe('section blocking lifecycle', () => {
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

    test('should not stop blocking if not currently active', () => {
      expect(blocker.isSectionBlocking()).toBe(false);
      blocker.stopSectionBlocking('test-section');
      expect(blocker.isSectionBlocking()).toBe(false);
    });
  });

  describe('overlay management', () => {
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

    test('should create header overlay', () => {
      // Add a header element for the test
      const header = document.createElement('header');
      header.style.height = '60px';
      document.body.appendChild(header);

      blocker.startSectionBlocking('test-section', mockData);

      const headerOverlay = document.getElementById('interactive-header-overlay');
      expect(headerOverlay).toBeTruthy();

      // Cleanup
      header.remove();
    });

    test('should create fullscreen overlay (initially hidden)', () => {
      blocker.startSectionBlocking('test-section', mockData);

      const fullscreenOverlay = document.getElementById('interactive-fullscreen-overlay');
      expect(fullscreenOverlay).toBeTruthy();
      expect(fullscreenOverlay?.style.display).toBe('none');
    });
  });

  describe('force unblock', () => {
    test('should force unblock section', () => {
      blocker.startSectionBlocking('test-section', mockData);

      expect(blocker.isSectionBlocking()).toBe(true);

      blocker.forceUnblock();

      expect(blocker.isSectionBlocking()).toBe(false);

      const overlay = document.getElementById('interactive-blocking-overlay');
      expect(overlay).toBeFalsy();
    });

    test('should clear modal polling interval on force unblock', () => {
      blocker.startSectionBlocking('test-section', mockData);
      blocker.forceUnblock();

      expect(mockTimeoutManager.clearInterval).toHaveBeenCalledWith('modal-polling-interval');
    });
  });

  describe('cancel callback', () => {
    test('should call cancel callback when cancelSection is invoked', () => {
      const cancelCallback = jest.fn();

      blocker.startSectionBlocking('test-section', mockData, cancelCallback);
      blocker.cancelSection();

      expect(cancelCallback).toHaveBeenCalled();
    });

    test('should not call cancel callback if not blocking', () => {
      const cancelCallback = jest.fn();

      // Don't start blocking, just try to cancel
      blocker.cancelSection();

      expect(cancelCallback).not.toHaveBeenCalled();
    });

    test('should not throw if no cancel callback provided', () => {
      blocker.startSectionBlocking('test-section', mockData);

      expect(() => blocker.cancelSection()).not.toThrow();
    });
  });

  describe('keyboard shortcut cancellation', () => {
    test('should call cancel callback on Ctrl+C when blocking and not in input field', () => {
      const cancelCallback = jest.fn();

      blocker.startSectionBlocking('test-section', mockData, cancelCallback);

      // Simulate Ctrl+C keydown
      const event = new KeyboardEvent('keydown', {
        key: 'c',
        ctrlKey: true,
        bubbles: true,
      });
      document.dispatchEvent(event);

      expect(cancelCallback).toHaveBeenCalled();
    });

    test('should call cancel callback on Cmd+C (Mac) when blocking', () => {
      const cancelCallback = jest.fn();

      blocker.startSectionBlocking('test-section', mockData, cancelCallback);

      // Simulate Cmd+C keydown (Mac)
      const event = new KeyboardEvent('keydown', {
        key: 'c',
        metaKey: true,
        bubbles: true,
      });
      document.dispatchEvent(event);

      expect(cancelCallback).toHaveBeenCalled();
    });

    test('should NOT cancel when in input field', () => {
      const cancelCallback = jest.fn();

      blocker.startSectionBlocking('test-section', mockData, cancelCallback);

      // Create an input and make it the target
      const input = document.createElement('input');
      document.body.appendChild(input);

      const event = new KeyboardEvent('keydown', {
        key: 'c',
        ctrlKey: true,
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: input });
      document.dispatchEvent(event);

      // Should NOT cancel because target is input
      expect(cancelCallback).not.toHaveBeenCalled();

      input.remove();
    });

    test('should NOT cancel when in textarea', () => {
      const cancelCallback = jest.fn();

      blocker.startSectionBlocking('test-section', mockData, cancelCallback);

      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);

      const event = new KeyboardEvent('keydown', {
        key: 'c',
        ctrlKey: true,
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: textarea });
      document.dispatchEvent(event);

      expect(cancelCallback).not.toHaveBeenCalled();

      textarea.remove();
    });

    test('should remove keyboard handler when blocking stops', () => {
      const cancelCallback = jest.fn();

      blocker.startSectionBlocking('test-section', mockData, cancelCallback);
      blocker.stopSectionBlocking('test-section');

      // Ctrl+C after stopping should not trigger callback
      const event = new KeyboardEvent('keydown', {
        key: 'c',
        ctrlKey: true,
        bubbles: true,
      });
      document.dispatchEvent(event);

      expect(cancelCallback).not.toHaveBeenCalled();
    });
  });

  describe('WYSIWYG editor exception', () => {
    test('should allow clicks within WYSIWYG editor container', () => {
      blocker.startSectionBlocking('test-section', mockData);

      const overlay = document.getElementById('interactive-blocking-overlay');
      expect(overlay).toBeTruthy();

      // Create a mock WYSIWYG editor element
      const editor = document.createElement('div');
      editor.classList.add('wysiwyg-editor-container');
      document.body.appendChild(editor);

      const button = document.createElement('button');
      editor.appendChild(button);

      // Simulate click on editor button
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      });

      // The click should not be blocked (no preventDefault called)
      button.addEventListener('click', () => {
        // Event handler triggered - verifies click went through
      });

      button.dispatchEvent(clickEvent);

      // Verify event was not prevented (WYSIWYG editor clicks should pass through)
      expect(clickEvent.defaultPrevented).toBe(false);

      // Cleanup
      editor.remove();
    });

    test('should allow clicks within ProseMirror editor', () => {
      blocker.startSectionBlocking('test-section', mockData);

      const proseMirror = document.createElement('div');
      proseMirror.classList.add('ProseMirror');
      document.body.appendChild(proseMirror);

      const span = document.createElement('span');
      proseMirror.appendChild(span);

      // Simulate click on ProseMirror content
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      });

      span.addEventListener('click', () => {
        // Event handler triggered - verifies click went through
      });

      span.dispatchEvent(clickEvent);

      // Verify event was not prevented (ProseMirror clicks should pass through)
      expect(clickEvent.defaultPrevented).toBe(false);

      // Cleanup
      proseMirror.remove();
    });
  });

  describe('modal state transitions', () => {
    test('should use TimeoutManager for modal polling', () => {
      blocker.startSectionBlocking('test-section', mockData);

      expect(mockTimeoutManager.setInterval).toHaveBeenCalledWith(
        'modal-polling-interval',
        expect.any(Function),
        expect.any(Number)
      );
    });

    test('should clear modal polling interval when stopping', () => {
      blocker.startSectionBlocking('test-section', mockData);
      blocker.stopSectionBlocking('test-section');

      expect(mockTimeoutManager.clearInterval).toHaveBeenCalledWith('modal-polling-interval');
    });
  });
});
