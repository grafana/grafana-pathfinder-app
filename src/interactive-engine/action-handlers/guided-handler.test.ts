import { GuidedHandler } from './guided-handler';
import { InteractiveStateManager } from '../interactive-state-manager';
import { NavigationManager } from '../navigation-manager';
import { querySelectorAllEnhanced } from '../../lib/dom';
import { withFaroUserAction } from '../../lib/faro';
import type { InteractiveElementData } from '../../types/interactive.types';
import { logger } from '../../lib/logging';

jest.mock('../interactive-state-manager');
jest.mock('../navigation-manager');
jest.mock('../../lib/faro', () => ({
  withFaroUserAction: jest.fn((_name: string, _attributes: unknown, work: () => unknown) => work()),
}));
jest.mock('../../lib/logging', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn() },
}));
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
      const data: InteractiveElementData = {
        refTarget: '#test',
        targetAction: 'guided',
        tagName: 'button',
        textContent: 'Test',
        timestamp: Date.now(),
      };

      await guidedHandler.execute(data, true);

      expect(mockStateManager.setState).toHaveBeenCalledWith(data, 'running');
      expect(mockStateManager.setState).toHaveBeenCalledWith(data, 'completed');
    });

    it('should call waitForReactUpdates when performGuided is false', async () => {
      const data: InteractiveElementData = {
        refTarget: '#test',
        targetAction: 'guided',
        tagName: 'button',
        textContent: 'Test',
        timestamp: Date.now(),
      };

      await guidedHandler.execute(data, false);

      expect(mockWaitForReactUpdates).toHaveBeenCalled();
    });
  });

  describe('resetProgress', () => {
    const runTwoStepSequence = async (labelPrefix: string) => {
      for (const stepIndex of [0, 1]) {
        await guidedHandler.executeGuidedStep(
          {
            targetAction: 'highlight',
            refTarget: '#drawer',
            targetState: true,
            targetComment: `${labelPrefix} step ${stepIndex}`,
          },
          stepIndex,
          2,
          5
        );
      }
    };

    const firstPaintOf = (labelPrefix: string) =>
      (mockNavigationManager.highlightWithComment as jest.Mock).mock.calls.find((call) =>
        String(call[1]).includes(`${labelPrefix} step 0`)
      )?.[3];

    beforeEach(() => {
      document.body.innerHTML = '<button id="drawer" aria-expanded="true">Add</button>';
      const button = document.querySelector<HTMLButtonElement>('#drawer')!;
      (querySelectorAllEnhanced as jest.Mock).mockReturnValue({ elements: [button], usedFallback: false });
      mockNavigationManager.highlightWithComment = jest.fn().mockResolvedValue(undefined);
    });

    it('clears prior-run credit so a restarted sequence paints from zero', async () => {
      await runTwoStepSequence('run A');
      expect(firstPaintOf('run A')).toMatchObject({ current: 0, completedSteps: [] });

      guidedHandler.resetProgress();
      await runTwoStepSequence('run B');

      expect(firstPaintOf('run B')).toMatchObject({ current: 0, total: 2, completedSteps: [], progress: 'performed' });
    });

    it('carries stale credit into a second sequence when it is not called', async () => {
      await runTwoStepSequence('run A');
      await runTwoStepSequence('run B');

      // Guard: this is the state resetProgress exists to prevent - a full bar
      // beside a "Step 1 of 2" badge. interactive-guided.tsx calls it at run start.
      expect(firstPaintOf('run B')).toMatchObject({ current: 0, completedSteps: [0, 1] });
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
        expect.objectContaining({ actionType: 'highlight', refTarget: refTarget })
      );

      expect(withFaroUserAction).toHaveBeenCalledWith(
        'pathfinder_do_it_button_click',
        { target_action: 'highlight', ref_target: refTarget, step_index: 0, total_steps: 1 },
        expect.any(Function),
        10_005,
        { critical: true, outcomeFrom: expect.any(Function) }
      );

      const options = (withFaroUserAction as jest.Mock).mock.calls[0][4];
      expect(options.outcomeFrom('completed')).toBe('ok');
      expect(options.outcomeFrom('timeout')).toBe('timeout');
      expect(options.outcomeFrom('cancelled')).toBe('cancelled');
      expect(options.outcomeFrom('skipped')).toBe('skipped');
      expect(options.outcomeFrom('error')).toBe('action_error');

      consoleErrorSpy.mockRestore();
    });

    // A guided step asks the user to click. If the toggle is already in the
    // requested state, that instruction would make them turn it off — the
    // toggle problem with a human in the loop.
    it('completes without waiting for a click when targetState is already satisfied', async () => {
      document.body.innerHTML = '<button id="drawer" aria-expanded="true">Add</button>';
      const button = document.querySelector<HTMLButtonElement>('#drawer')!;
      (querySelectorAllEnhanced as jest.Mock).mockReturnValue({ elements: [button], usedFallback: false });
      mockNavigationManager.highlightWithComment = jest.fn().mockResolvedValue(undefined);

      const result = await guidedHandler.executeGuidedStep(
        { targetAction: 'highlight', refTarget: '#drawer', targetState: true, targetComment: '<p>Click Add</p>' },
        0,
        1,
        5
      );

      expect(result).toBe('completed');
      expect(button.getAttribute('aria-expanded')).toBe('true');
      // Without the note the box would flash "Click Add" and vanish.
      const [highlighted, shownComment] = (mockNavigationManager.highlightWithComment as jest.Mock).mock.calls[0];
      expect(highlighted).toBe(button);
      expect(shownComment).toContain('Already in the right position');
      expect(shownComment).toContain('Click Add');
    });

    it('asks for performed progress, crediting only steps the reader finished', async () => {
      document.body.innerHTML = '<button id="drawer" aria-expanded="true">Add</button>';
      const button = document.querySelector<HTMLButtonElement>('#drawer')!;
      (querySelectorAllEnhanced as jest.Mock).mockReturnValue({ elements: [button], usedFallback: false });
      mockNavigationManager.highlightWithComment = jest.fn().mockResolvedValue(undefined);

      await guidedHandler.executeGuidedStep(
        { targetAction: 'highlight', refTarget: '#drawer', targetState: true, targetComment: 'First instruction' },
        0,
        2,
        5
      );
      await guidedHandler.executeGuidedStep(
        { targetAction: 'highlight', refTarget: '#drawer', targetState: true, targetComment: 'Second instruction' },
        1,
        2,
        5
      );

      const paints = (mockNavigationManager.highlightWithComment as jest.Mock).mock.calls;
      const stepInfoFor = (needle: string) => paints.find((call) => String(call[1]).includes(needle))?.[3];

      expect(stepInfoFor('First instruction')).toEqual({
        current: 0,
        total: 2,
        completedSteps: [],
        progress: 'performed',
      });
      expect(stepInfoFor('Second instruction')).toEqual({
        current: 1,
        total: 2,
        completedSteps: [0],
        progress: 'performed',
      });
    });

    it('still waits for the user when targetState is not yet satisfied', async () => {
      document.body.innerHTML = '<button id="drawer" aria-expanded="false">Add</button>';
      const button = document.querySelector<HTMLButtonElement>('#drawer')!;
      (querySelectorAllEnhanced as jest.Mock).mockReturnValue({ elements: [button], usedFallback: false });
      // Stand in for the user performing the click the guided step asked for.
      mockNavigationManager.highlightWithComment = jest.fn().mockImplementation(async () => {
        button.setAttribute('aria-expanded', 'true');
        button.click();
      });

      const result = await guidedHandler.executeGuidedStep(
        { targetAction: 'highlight', refTarget: '#drawer', targetState: true },
        0,
        1,
        5
      );

      expect(result).toBe('completed');
      expect(mockNavigationManager.highlightWithComment).toHaveBeenCalled();
    });

    it('persists final click completion before the target replaces its DOM subtree', async () => {
      document.body.innerHTML = '<main id="route"><button id="install">Install</button></main>';
      const button = document.querySelector<HTMLButtonElement>('#install')!;
      const eventOrder: string[] = [];
      (querySelectorAllEnhanced as jest.Mock).mockReturnValue({ elements: [button], usedFallback: false });
      button.addEventListener('click', () => {
        eventOrder.push('route changed');
        document.querySelector('#route')?.remove();
      });
      mockNavigationManager.highlightWithComment = jest.fn().mockImplementation(async () => {
        button.click();
      });

      const result = await guidedHandler.executeGuidedStep(
        { targetAction: 'highlight', refTarget: '#install' },
        0,
        1,
        100,
        () => eventOrder.push('completion persisted')
      );

      expect(result).toBe('completed');
      expect(eventOrder).toEqual(['completion persisted', 'route changed']);
      expect(button.isConnected).toBe(false);
      expect(mockNavigationManager.clearAllHighlights).toHaveBeenCalled();
    });

    it('keeps completed when highlighting throws after an early click', async () => {
      document.body.innerHTML = '<button id="install">Install</button>';
      const button = document.querySelector<HTMLButtonElement>('#install')!;
      const onActionCompleted = jest.fn();
      (querySelectorAllEnhanced as jest.Mock).mockReturnValue({ elements: [button], usedFallback: false });
      mockNavigationManager.highlightWithComment = jest.fn().mockImplementation(async () => {
        button.click();
        throw new Error('highlight failed after click');
      });

      const result = await guidedHandler.executeGuidedStep(
        { targetAction: 'highlight', refTarget: '#install' },
        0,
        1,
        100,
        onActionCompleted
      );

      expect(result).toBe('completed');
      expect(onActionCompleted).toHaveBeenCalledTimes(1);
    });

    it('keeps completed when cleanup throws after persistence', async () => {
      document.body.innerHTML = '<button id="install">Install</button>';
      const button = document.querySelector<HTMLButtonElement>('#install')!;
      (querySelectorAllEnhanced as jest.Mock).mockReturnValue({ elements: [button], usedFallback: false });
      mockNavigationManager.highlightWithComment = jest.fn().mockImplementation(async () => {
        button.click();
      });
      mockNavigationManager.clearAllHighlights = jest.fn(() => {
        throw new Error('cleanup failed');
      });

      const result = await guidedHandler.executeGuidedStep(
        { targetAction: 'highlight', refTarget: '#install' },
        0,
        1,
        100,
        jest.fn()
      );

      expect(result).toBe('completed');
    });

    it('does not complete after cancellation wins before a later click', async () => {
      document.body.innerHTML = '<button id="install">Install</button>';
      const button = document.querySelector<HTMLButtonElement>('#install')!;
      const onActionCompleted = jest.fn();
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      (querySelectorAllEnhanced as jest.Mock).mockReturnValue({ elements: [button], usedFallback: false });
      mockNavigationManager.highlightWithComment = jest.fn().mockImplementation(async () => {
        document.dispatchEvent(new CustomEvent('guided-step-cancelled', { detail: { stepIndex: 0 } }));
        button.click();
      });

      const result = await guidedHandler.executeGuidedStep(
        { targetAction: 'highlight', refTarget: '#install' },
        0,
        1,
        100,
        onActionCompleted
      );

      expect(result).toBe('cancelled');
      expect(onActionCompleted).not.toHaveBeenCalled();
      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });

    it('does not complete after skip wins before a later click', async () => {
      document.body.innerHTML = '<button id="install">Install</button>';
      const button = document.querySelector<HTMLButtonElement>('#install')!;
      const onActionCompleted = jest.fn();
      (querySelectorAllEnhanced as jest.Mock).mockReturnValue({ elements: [button], usedFallback: false });
      mockNavigationManager.highlightWithComment = jest.fn().mockImplementation(async () => {
        document.dispatchEvent(new CustomEvent('guided-step-skipped', { detail: { stepIndex: 0 } }));
        button.click();
      });

      const result = await guidedHandler.executeGuidedStep(
        { targetAction: 'highlight', refTarget: '#install', isSkippable: true },
        0,
        1,
        100,
        onActionCompleted
      );

      expect(result).toBe('skipped');
      expect(onActionCompleted).not.toHaveBeenCalled();
    });

    it('reports an error when the completion callback throws', async () => {
      document.body.innerHTML = '<button id="install">Install</button>';
      const button = document.querySelector<HTMLButtonElement>('#install')!;
      const onActionCompleted = jest.fn(() => {
        throw new Error('persistence failed');
      });
      (querySelectorAllEnhanced as jest.Mock).mockReturnValue({ elements: [button], usedFallback: false });
      mockNavigationManager.highlightWithComment = jest.fn().mockImplementation(async () => {
        button.click();
      });

      const result = await guidedHandler.executeGuidedStep(
        { targetAction: 'highlight', refTarget: '#install' },
        0,
        1,
        100,
        onActionCompleted
      );

      expect(result).toBe('error');
      expect(onActionCompleted).toHaveBeenCalledTimes(1);
      expect(mockNavigationManager.clearAllHighlights).toHaveBeenCalled();
      expect((guidedHandler as any).activeListeners).toHaveLength(0);
      expect((guidedHandler as any).pendingTimeouts).toHaveLength(0);
      expect((guidedHandler as any).pendingIntervals).toHaveLength(0);
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

  describe('verbs the handler cannot drive', () => {
    // `JsonGuidedBlockSchema` shares its step schema with multistep, so a guide
    // published before the authoring gate existed can still carry these. The
    // step must settle without reaching a listener that cannot settle it — see
    // `validate-guide.ts` / `allowUnsupportedGuidedAction`.
    const UNDRIVABLE = ['navigate', 'popout', 'multistep', 'guided'] as const;

    let documentListener: jest.SpyInstance;

    beforeEach(() => {
      // A resolvable target, so a step that settles without touching the
      // element proves the verb was refused before resolution rather than
      // merely failing to find anything.
      document.body.innerHTML = '<button id="target">Go</button>';
      const target = document.querySelector<HTMLButtonElement>('#target')!;
      documentListener = jest.spyOn(document, 'addEventListener');
      (querySelectorAllEnhanced as jest.Mock).mockReturnValue({ elements: [target], usedFallback: false });
    });

    const expectNothingDriven = (targetAction: string) => {
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('cannot drive'),
        expect.objectContaining({ targetAction })
      );
      // The completion, skip, and cancel listeners all bind on `document`.
      expect(documentListener).not.toHaveBeenCalled();
      // Nothing was highlighted, so the reader was never asked to act.
      expect(mockNavigationManager.highlightWithComment).not.toHaveBeenCalled();
    };

    it.each(UNDRIVABLE)('reports a non-skippable guided "%s" step as an error', async (targetAction) => {
      const result = await guidedHandler.executeGuidedStep({ targetAction, refTarget: '#target' }, 0, 1, 1000);

      expect(result).toBe('error');
      expectNothingDriven(targetAction);
    });

    // An author marking the step skippable is asking for exactly this, and it is
    // what element resolution already produced for a `navigate` step whose
    // refTarget is a URL path — the guided run must keep going.
    it.each(UNDRIVABLE)('skips a skippable guided "%s" step so the run continues', async (targetAction) => {
      const result = await guidedHandler.executeGuidedStep(
        { targetAction, refTarget: '#target', isSkippable: true },
        0,
        1,
        1000
      );

      expect(result).toBe('skipped');
      expectNothingDriven(targetAction);
    });

    it('credits a skipped undrivable step so the next step paints it as done', async () => {
      await guidedHandler.executeGuidedStep(
        { targetAction: 'navigate', refTarget: '/explore', isSkippable: true },
        0,
        2,
        5
      );
      await guidedHandler.executeGuidedStep({ targetAction: 'highlight', refTarget: '#target' }, 1, 2, 5);

      expect((mockNavigationManager.highlightWithComment as jest.Mock).mock.calls[0]![3]).toMatchObject({
        completedSteps: [0],
      });
    });

    it('does not reject, so the caller sees a result rather than a thrown error', async () => {
      await expect(
        guidedHandler.executeGuidedStep({ targetAction: 'navigate', refTarget: '/explore' }, 0, 1, 1000)
      ).resolves.toBe('error');
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

  describe('Progress bar completion delay behavior', () => {
    let progressBar: HTMLElement;

    beforeEach(() => {
      jest.useFakeTimers();
      document.body.innerHTML = '<button id="target">Click me</button>';
      const button = document.querySelector<HTMLButtonElement>('#target')!;
      (querySelectorAllEnhanced as jest.Mock).mockReturnValue({ elements: [button], usedFallback: false });
      mockNavigationManager.highlightWithComment = jest.fn().mockImplementation(async () => {
        // Create a progress bar in the DOM when highlightWithComment is called
        progressBar = document.createElement('div');
        progressBar.className = 'interactive-comment-progress-bar';
        progressBar.style.width = '0%';
        document.body.appendChild(progressBar);
      });
    });

    afterEach(() => {
      jest.useRealTimers();
      guidedHandler.cancel();
    });

    it('sets progress bar to 100% on final step completion before cleanup', async () => {
      const button = document.querySelector<HTMLButtonElement>('#target')!;

      // Execute final step (stepIndex=1, totalSteps=2)
      const completionPromise = guidedHandler.executeGuidedStep(
        {
          targetAction: 'highlight',
          refTarget: '#target',
          targetComment: 'Final step',
        },
        1, // Final step (stepIndex = 1)
        2, // Total steps = 2
        5000
      );

      // Wait for async setup to complete (highlightWithComment called, progress bar created)
      await jest.advanceTimersByTimeAsync(0);

      // Trigger the click to complete the step
      button.click();

      // Wait for click handler async operations to complete
      await jest.advanceTimersByTimeAsync(0);

      // Verify progress bar was set to 100%
      expect(progressBar.style.width).toBe('100%');

      // Verify cleanup hasn't happened yet
      expect(mockNavigationManager.clearAllHighlights).not.toHaveBeenCalled();

      // Complete the delay
      await jest.advanceTimersByTimeAsync(600);

      // Now cleanup should have been called
      await completionPromise;
      expect(mockNavigationManager.clearAllHighlights).toHaveBeenCalled();
    });

    it('delays cleanup until after ~600ms on final step', async () => {
      const button = document.querySelector<HTMLButtonElement>('#target')!;

      const completionPromise = guidedHandler.executeGuidedStep(
        {
          targetAction: 'highlight',
          refTarget: '#target',
          targetComment: 'Final step',
        },
        1, // Final step
        2, // Total steps
        5000
      );

      // Wait for async setup to complete
      await jest.advanceTimersByTimeAsync(0);

      // Trigger the click
      button.click();

      // Wait for click handler async operations
      await jest.advanceTimersByTimeAsync(0);

      // Verify clearAllHighlights has NOT been called yet
      expect(mockNavigationManager.clearAllHighlights).not.toHaveBeenCalled();

      // Advance by partial delay
      await jest.advanceTimersByTimeAsync(300);
      expect(mockNavigationManager.clearAllHighlights).not.toHaveBeenCalled();

      // Complete the delay (600ms total)
      await jest.advanceTimersByTimeAsync(300);

      // Wait for completion
      await completionPromise;

      // Now cleanup should have been called
      expect(mockNavigationManager.clearAllHighlights).toHaveBeenCalled();
    });

    it('resolves immediately when cancelled during the 600ms delay', async () => {
      const button = document.querySelector<HTMLButtonElement>('#target')!;

      const completionPromise = guidedHandler.executeGuidedStep(
        {
          targetAction: 'highlight',
          refTarget: '#target',
          targetComment: 'Final step',
        },
        1, // Final step
        2, // Total steps
        5000
      );

      // Wait for async setup to complete
      await jest.advanceTimersByTimeAsync(0);

      // Trigger the click
      button.click();

      // Wait for click handler async operations
      await jest.advanceTimersByTimeAsync(0);

      // Assert: progress bar is at 100% BEFORE cancel
      expect(progressBar.style.width).toBe('100%');

      // Record timer count - the 600ms delay timer should be active
      const timerCountBeforeCancel = jest.getTimerCount();
      expect(timerCountBeforeCancel).toBeGreaterThan(0);

      // Cancel during the delay
      guidedHandler.cancel();

      // Wait for cancel to propagate
      await jest.advanceTimersByTimeAsync(0);

      // Assert: timer was cleared (delay timer should be gone)
      expect(jest.getTimerCount()).toBeLessThan(timerCountBeforeCancel);

      // The completion promise should resolve without advancing the full 600ms
      const result = await completionPromise;
      expect(result).toBe('completed');

      // Verify cleanup was called
      expect(mockNavigationManager.clearAllHighlights).toHaveBeenCalled();
    });

    it('prevents click re-entry during post-settle 600ms window (B3 regression)', async () => {
      const button = document.querySelector<HTMLButtonElement>('#target')!;

      // Track how many times element.click() is called
      const originalClick = button.click.bind(button);
      let clickCount = 0;
      button.click = jest.fn(() => {
        clickCount++;
        originalClick();
      });

      const completionPromise = guidedHandler.executeGuidedStep(
        {
          targetAction: 'highlight',
          refTarget: '#target',
          targetComment: 'Final step',
        },
        1, // Final step
        2, // Total steps
        5000
      );

      // Wait for async setup to complete
      await jest.advanceTimersByTimeAsync(0);

      // First click: user clicks the target directly - this completes the step
      button.click();

      // Wait for click handler async operations (now in the 600ms settling window)
      await jest.advanceTimersByTimeAsync(0);

      // Progress bar should be at 100%
      expect(progressBar.style.width).toBe('100%');

      // Reset click count to track only the second click
      clickCount = 0;

      // Second click: user clicks outside the target but within the 16px padding ring
      // Simulate a click at a position that satisfies isWithinBounds but not on the element
      const buttonRect = button.getBoundingClientRect();
      const outsideButNearClick = new MouseEvent('click', {
        clientX: buttonRect.right + 10, // 10px to the right (inside 16px padding)
        clientY: buttonRect.top + 5, // On the vertical center line
        bubbles: true,
      });

      // Dispatch the second click during the settling window
      document.dispatchEvent(outsideButNearClick);

      // Wait for any async handlers
      await jest.advanceTimersByTimeAsync(0);

      // Assert: The completing flag should have prevented the re-entry
      // element.click() should NOT have been called again
      expect(clickCount).toBe(0);

      // Complete the delay
      await jest.advanceTimersByTimeAsync(600);

      // Verify normal completion
      const result = await completionPromise;
      expect(result).toBe('completed');
      expect(mockNavigationManager.clearAllHighlights).toHaveBeenCalled();
    });
    it('shows 100% on single-step tour completion', async () => {
      const button = document.querySelector<HTMLButtonElement>('#target')!;

      const completionPromise = guidedHandler.executeGuidedStep(
        {
          targetAction: 'highlight',
          refTarget: '#target',
          targetComment: 'Only step',
        },
        0, // stepIndex = 0
        1, // totalSteps = 1 (single-step tour)
        5000
      );

      // Wait for async setup to complete
      await jest.advanceTimersByTimeAsync(0);

      // Trigger the click
      button.click();

      // Wait for click handler async operations
      await jest.advanceTimersByTimeAsync(0);

      // Verify progress bar was set to 100% (single step is final step)
      expect(progressBar.style.width).toBe('100%');

      // Complete the delay
      await jest.advanceTimersByTimeAsync(600);

      // Verify completion
      const result = await completionPromise;
      expect(result).toBe('completed');
      expect(mockNavigationManager.clearAllHighlights).toHaveBeenCalled();
    });

    it('does NOT delay cleanup for non-final steps', async () => {
      const button = document.querySelector<HTMLButtonElement>('#target')!;

      const completionPromise = guidedHandler.executeGuidedStep(
        {
          targetAction: 'highlight',
          refTarget: '#target',
          targetComment: 'First step',
        },
        0, // stepIndex = 0 (NOT final)
        3, // totalSteps = 3
        5000
      );

      // Wait for async setup to complete
      await jest.advanceTimersByTimeAsync(0);

      // Trigger the click
      button.click();

      // Wait for click handler async operations
      await jest.advanceTimersByTimeAsync(0);

      // Non-final step should NOT set progress to 100%
      // Progress bar stays at initial value
      expect(progressBar.style.width).toBe('0%');

      // Wait for completion (should be immediate after click, no delay)
      const result = await completionPromise;
      expect(result).toBe('completed');

      // Cleanup should have been called immediately, without waiting for delay
      expect(mockNavigationManager.clearAllHighlights).toHaveBeenCalled();
    });

    it('skipped final step also shows 100% briefly before cleanup', async () => {
      mockNavigationManager.highlightWithComment = jest.fn().mockImplementation(async () => {
        // Create progress bar
        progressBar = document.createElement('div');
        progressBar.className = 'interactive-comment-progress-bar';
        progressBar.style.width = '50%';
        document.body.appendChild(progressBar);
      });

      const completionPromise = guidedHandler.executeGuidedStep(
        {
          targetAction: 'highlight',
          refTarget: '#target',
          targetComment: 'Final step',
          isSkippable: true,
        },
        2, // Final step
        3, // Total steps
        5000
      );

      // Wait for async setup to complete
      await jest.advanceTimersByTimeAsync(0);

      // Trigger the skip event
      document.dispatchEvent(new CustomEvent('guided-step-skipped', { detail: { stepIndex: 2 } }));

      // Wait for skip handler async operations
      await jest.advanceTimersByTimeAsync(0);

      // Verify progress bar was set to 100% even though skipped
      expect(progressBar.style.width).toBe('100%');

      // Complete the delay
      await jest.advanceTimersByTimeAsync(600);

      // Verify completion as skipped
      const result = await completionPromise;
      expect(result).toBe('skipped');
      expect(mockNavigationManager.clearAllHighlights).toHaveBeenCalled();
    });

    it('does NOT show 100% or delay for error results', async () => {
      mockNavigationManager.highlightWithComment = jest.fn().mockImplementation(async () => {
        // Create progress bar
        progressBar = document.createElement('div');
        progressBar.className = 'interactive-comment-progress-bar';
        progressBar.style.width = '66%';
        document.body.appendChild(progressBar);
        // Throw an error
        throw new Error('Test error');
      });

      const completionPromise = guidedHandler.executeGuidedStep(
        {
          targetAction: 'highlight',
          refTarget: '#target',
          targetComment: 'Final step',
        },
        1, // Final step
        2, // Total steps
        5000
      );

      // Wait for async operations to complete
      await jest.advanceTimersByTimeAsync(0);

      // Complete
      const result = await completionPromise;
      expect(result).toBe('error');

      // Verify progress bar was NOT set to 100% (error case)
      expect(progressBar.style.width).toBe('66%');

      // Cleanup should happen immediately without delay
      expect(mockNavigationManager.clearAllHighlights).toHaveBeenCalled();
    });

    it('handles missing progress bar gracefully without crashing', async () => {
      const button = document.querySelector<HTMLButtonElement>('#target')!;

      mockNavigationManager.highlightWithComment = jest.fn().mockImplementation(async () => {
        // Do NOT create a progress bar - simulate DOM missing the element
      });

      const completionPromise = guidedHandler.executeGuidedStep(
        {
          targetAction: 'highlight',
          refTarget: '#target',
          targetComment: 'Final step',
        },
        1, // Final step
        2, // Total steps
        5000
      );

      // Wait for async setup to complete
      await jest.advanceTimersByTimeAsync(0);

      // Trigger the click
      button.click();

      // Wait for click handler and fast-forward through delay
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(700);

      // Should complete without crashing
      const result = await completionPromise;
      expect(result).toBe('completed');
      expect(mockNavigationManager.clearAllHighlights).toHaveBeenCalled();
    });
  });
});
