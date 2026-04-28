import { GuidedHandler } from './guided-handler';
import { InteractiveStateManager } from '../interactive-state-manager';
import { NavigationManager } from '../navigation-manager';
import { querySelectorAllEnhanced } from '../../lib/dom';

// Mock dependencies
jest.mock('../interactive-state-manager');
jest.mock('../navigation-manager');
jest.mock('../../lib/dom', () => ({
  querySelectorAllEnhanced: jest.fn().mockReturnValue({ elements: [], usedFallback: false }),
  findButtonByText: jest.fn().mockReturnValue([]),
  isElementVisible: jest.fn().mockReturnValue(true),
  resolveSelector: jest.fn((selector: string) => selector),
}));
jest.mock('../../lib/dom/selector-detector', () => ({
  isCssSelector: jest.fn().mockReturnValue(false),
}));

describe('GuidedHandler', () => {
  let guidedHandler: GuidedHandler;
  let mockStateManager: jest.Mocked<InteractiveStateManager>;
  let mockNavigationManager: jest.Mocked<NavigationManager>;
  let mockWaitForReactUpdates: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mocks
    mockStateManager = new InteractiveStateManager() as jest.Mocked<InteractiveStateManager>;
    mockStateManager.setState = jest.fn();
    mockStateManager.handleError = jest.fn();

    mockNavigationManager = new NavigationManager() as jest.Mocked<NavigationManager>;
    mockNavigationManager.ensureNavigationOpen = jest.fn().mockResolvedValue(undefined);
    mockNavigationManager.ensureElementVisible = jest.fn().mockResolvedValue(undefined);
    mockNavigationManager.highlightWithComment = jest.fn().mockResolvedValue(undefined);
    mockNavigationManager.clearAllHighlights = jest.fn();

    mockWaitForReactUpdates = jest.fn().mockResolvedValue(undefined);

    guidedHandler = new GuidedHandler(mockStateManager, mockNavigationManager, mockWaitForReactUpdates);
  });

  afterEach(() => {
    guidedHandler.cancel();
  });

  describe('execute', () => {
    it('should set state to running and then completed', async () => {
      const data = {
        reftarget: '#test',
        targetaction: 'guided',
        tagName: 'button',
        textContent: 'Test',
        timestamp: Date.now(),
      };

      await guidedHandler.execute(data, true);

      expect(mockStateManager.setState).toHaveBeenCalledWith(data, 'running');
      expect(mockStateManager.setState).toHaveBeenCalledWith(data, 'completed');
    });

    it('should call waitForReactUpdates when performGuided is false', async () => {
      const data = {
        reftarget: '#test',
        targetaction: 'guided',
        tagName: 'button',
        textContent: 'Test',
        timestamp: Date.now(),
      };

      await guidedHandler.execute(data, false);

      expect(mockWaitForReactUpdates).toHaveBeenCalled();
    });
  });

  describe('resetProgress', () => {
    it('should reset completed steps tracking', () => {
      guidedHandler.resetProgress();
      // Method should not throw
      expect(guidedHandler.resetProgress).toBeDefined();
    });
  });

  describe('executeGuidedStep', () => {
    it('should expand parent navigation before resolving a nested guided nav target', async () => {
      const refTarget = "a[data-testid='data-testid Nav menu item'][href='/alerting/list']";
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      document.body.innerHTML = `
        <nav>
          <a data-testid="data-testid Nav menu item" href="/alerting">Alerting</a>
          <button type="button" aria-label="Expand section: Alerting" aria-expanded="false">Expand</button>
        </nav>
      `;

      (querySelectorAllEnhanced as jest.Mock).mockImplementation((selector: string) => ({
        elements: Array.from(document.querySelectorAll(selector)),
        usedFallback: false,
      }));

      mockNavigationManager.expandParentNavigationSection = jest.fn().mockImplementation(async (targetHref: string) => {
        const expandButton = document.querySelector('button[aria-label="Expand section: Alerting"]');
        expandButton?.setAttribute('aria-expanded', 'true');

        const nestedLink = document.createElement('a');
        nestedLink.setAttribute('data-testid', 'data-testid Nav menu item');
        nestedLink.setAttribute('href', targetHref);
        nestedLink.textContent = 'Alert rules';
        document.querySelector('nav')?.appendChild(nestedLink);

        return true;
      });
      mockNavigationManager.highlightWithComment = jest.fn().mockImplementation(async (targetElement: HTMLElement) => {
        targetElement.click();
      });

      const result = await guidedHandler.executeGuidedStep(
        {
          targetAction: 'highlight',
          refTarget,
          targetComment: 'Click Alert rules in the Alerting menu.',
        },
        0,
        1,
        5
      );

      expect(result).toBe('completed');
      expect(mockNavigationManager.expandParentNavigationSection).toHaveBeenCalledWith('/alerting/list');
      expect(document.querySelector('button[aria-label="Expand section: Alerting"]')).toHaveAttribute(
        'aria-expanded',
        'true'
      );
      expect(document.querySelector(refTarget)).toBeInTheDocument();
      expect(mockNavigationManager.ensureNavigationOpen).toHaveBeenCalledWith(document.querySelector(refTarget));
      expect(mockNavigationManager.highlightWithComment).toHaveBeenCalledWith(
        document.querySelector(refTarget),
        'Click Alert rules in the Alerting menu.',
        false,
        expect.objectContaining({ current: 0, total: 1 }),
        undefined,
        expect.any(Function),
        undefined,
        undefined,
        expect.objectContaining({ actionType: 'highlight', reftarget: refTarget })
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('cancel', () => {
    it('should handle cancel calls gracefully', () => {
      guidedHandler.cancel();
      // Should not throw and should cleanup properly
      expect(guidedHandler.cancel).toBeDefined();
    });

    it('should handle multiple cancel calls gracefully', () => {
      guidedHandler.cancel();
      guidedHandler.cancel();
      guidedHandler.cancel();
      // Should not throw
      expect(true).toBe(true);
    });

    it('should remove all tracked event listeners when cancel is called', () => {
      // Spy on document event listener methods
      const addEventListenerSpy = jest.spyOn(document, 'addEventListener');
      const removeEventListenerSpy = jest.spyOn(document, 'removeEventListener');

      // Access private activeListeners array via any cast to simulate tracked listeners
      // This tests that cleanupListeners() properly removes all tracked listeners
      const handler = guidedHandler as any;

      // Manually add listeners to activeListeners to simulate what createSkipListener/createCancelListener do
      const skipHandler = jest.fn();
      const cancelHandler = jest.fn();

      document.addEventListener('guided-step-skipped', skipHandler);
      handler.activeListeners.push({
        target: document,
        type: 'guided-step-skipped',
        handler: skipHandler,
      });

      document.addEventListener('guided-step-cancelled', cancelHandler);
      handler.activeListeners.push({
        target: document,
        type: 'guided-step-cancelled',
        handler: cancelHandler,
      });

      // Verify listeners were added
      expect(addEventListenerSpy).toHaveBeenCalledWith('guided-step-skipped', skipHandler);
      expect(addEventListenerSpy).toHaveBeenCalledWith('guided-step-cancelled', cancelHandler);

      // Call cancel which should clean up all listeners
      guidedHandler.cancel();

      // Verify listeners were removed
      expect(removeEventListenerSpy).toHaveBeenCalledWith('guided-step-skipped', skipHandler);
      expect(removeEventListenerSpy).toHaveBeenCalledWith('guided-step-cancelled', cancelHandler);

      // Verify activeListeners array is empty after cleanup
      expect(handler.activeListeners).toHaveLength(0);

      // Cleanup spies
      addEventListenerSpy.mockRestore();
      removeEventListenerSpy.mockRestore();
    });
  });

  describe('ActiveListener type safety', () => {
    it('should use EventTarget type for listener cleanup', () => {
      // This is a compile-time test - if the types are wrong, TypeScript will fail
      // We verify the handler can be created and cancelled without type errors
      const handler = new GuidedHandler(mockStateManager, mockNavigationManager, mockWaitForReactUpdates);
      handler.cancel();
      expect(handler).toBeDefined();
    });
  });
});
