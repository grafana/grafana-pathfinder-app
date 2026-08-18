import { GuidedHandler } from './guided-handler';
import { InteractiveStateManager } from '../interactive-state-manager';
import { NavigationManager } from '../navigation-manager';
import { querySelectorAllEnhanced, scrollUntilElementFound } from '../../lib/dom';
import { withFaroUserAction } from '../../lib/faro';
import { GUIDED_SUBSTEP_SETTLED_EVENT } from '../../constants/interactive-config';

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
  scrollUntilElementFound: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../lib/dom/selector-detector', () => ({
  isCssSelector: jest.fn().mockReturnValue(false),
}));

describe('GuidedHandler', () => {
  let guidedHandler: GuidedHandler;
  let mockStateManager: jest.Mocked<InteractiveStateManager>;
  let mockNavigationManager: jest.Mocked<NavigationManager>;
  let mockWaitForReactUpdates: jest.Mock;
  let mockCheckRequirements: jest.Mock;

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
    mockCheckRequirements = jest.fn().mockResolvedValue({ pass: true });

    guidedHandler = new GuidedHandler(
      mockStateManager,
      mockNavigationManager,
      mockWaitForReactUpdates,
      mockCheckRequirements
    );
  });

  afterEach(() => {
    guidedHandler.cancel();
  });

  describe('execute', () => {
    it('should set state to running and then completed', async () => {
      const data = {
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

    it('publishes every consecutive requirement-driven skip exactly once', async () => {
      mockCheckRequirements.mockResolvedValue({ pass: false });
      const settled: Array<CustomEvent['detail']> = [];
      const root = document.createElement('div');
      root.id = 'guided-parent';
      document.body.appendChild(root);
      const listener = (event: Event) => {
        const detail = (event as CustomEvent).detail;
        settled.push(detail);
        if (detail.index === 3) {
          root.remove();
        }
      };
      document.addEventListener(GUIDED_SUBSTEP_SETTLED_EVENT, listener);
      guidedHandler.resetProgress();

      for (let index = 0; index < 4; index++) {
        await expect(
          guidedHandler.executeGuidedStep(
            {
              targetAction: 'highlight',
              refTarget: `#missing-${index}`,
              requirements: `var-step-${index}:true`,
              isSkippable: true,
            },
            index,
            4,
            30000,
            undefined,
            { parentStepId: 'guided-parent', guideId: 'guide-scope' }
          )
        ).resolves.toBe('skipped');
      }

      document.removeEventListener(GUIDED_SUBSTEP_SETTLED_EVENT, listener);
      expect(settled).toEqual([
        { stepId: 'guided-parent', index: 0, action: 'highlight', outcome: 'skipped' },
        { stepId: 'guided-parent', index: 1, action: 'highlight', outcome: 'skipped' },
        { stepId: 'guided-parent', index: 2, action: 'highlight', outcome: 'skipped' },
        { stepId: 'guided-parent', index: 3, action: 'highlight', outcome: 'skipped' },
      ]);
      expect(mockCheckRequirements).toHaveBeenLastCalledWith(
        expect.objectContaining({ guideId: 'guide-scope', maxRetries: 0 })
      );
      expect(document.getElementById('guided-parent')).toBeNull();
    });

    it('should call waitForReactUpdates when performGuided is false', async () => {
      const data = {
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
    it('should reset completed steps tracking', () => {
      guidedHandler.resetProgress();
      // Method should not throw
      expect(guidedHandler.resetProgress).toBeDefined();
    });
  });

  describe('executeGuidedStep', () => {
    it('forwards all authored requirement entries to the shared checker before target resolution', async () => {
      const requirementShapes = [
        'exists-reftarget',
        'navmenu-open',
        'has-datasources',
        'is-admin',
        'is-logged-in',
        'is-editor',
        'dashboard-exists',
        'form-valid',
        'is-terminal-active',
        'has-permission:dashboards.create',
        'has-permission:datasources.read',
        'has-role:admin',
        'has-role:editor',
        'has-datasource:prometheus',
        'has-datasource:loki',
        'datasource-configured:prometheus',
        'datasource-configured:loki',
        'has-plugin:grafana-clock-panel',
        'has-plugin:grafana-pyroscope-app',
        'plugin-enabled:grafana-clock-panel',
        'plugin-enabled:grafana-pyroscope-app',
        'has-dashboard-named:Node Exporter Full',
        'has-dashboard-named:Welcome',
        'on-page:/dashboards',
        'on-page:/explore',
        'has-feature:publicDashboards',
        'has-feature:accessControlOnCall',
        'in-environment:cloud',
        'in-environment:oss',
        'min-version:10.4.0',
        'min-version:11.0.0',
        'section-completed:intro',
        'section-completed:setup',
        'var-policyAccepted:true',
        'var-region:us-east-1',
        'renderer:pathfinder',
        'renderer:website',
        'coda-exit-zero:test -f /etc/myapp.conf',
        'coda-exit-zero:curl -sf localhost:9090/-/healthy',
        'has-permission:folders.read',
        'has-role:viewer',
        'has-datasource:tempo',
        'datasource-configured:tempo',
        'has-plugin:grafana-oncall-app',
        'plugin-enabled:grafana-oncall-app',
        'has-dashboard-named:Kubernetes',
        'on-page:/alerting/list',
        'has-feature:alerting',
        'in-environment:enterprise',
        'min-version:12.0.0',
        'section-completed:finish',
        'var-completed:true',
        'coda-exit-zero:systemctl is-active grafana-server',
      ];
      const requirements = requirementShapes.join(',');
      mockCheckRequirements.mockResolvedValue({ pass: false });

      const result = await guidedHandler.executeGuidedStep(
        {
          targetAction: 'highlight',
          refTarget: '#target',
          requirements,
          isSkippable: true,
          lazyRender: true,
          scrollContainer: '.dashboard-scroll',
        },
        0,
        1,
        100
      );

      expect(requirementShapes).toHaveLength(53);
      expect(result).toBe('skipped');
      expect(mockCheckRequirements).toHaveBeenCalledWith(
        expect.objectContaining({
          requirements,
          targetAction: 'highlight',
          refTarget: '#target',
          targetValue: undefined,
          stepId: 'guided-substep-0',
          lazyRender: true,
          scrollContainer: '.dashboard-scroll',
          discoverLazyTarget: true,
          guideId: undefined,
          maxRetries: 0,
          deadlineMs: expect.any(Number),
        })
      );
      expect(querySelectorAllEnhanced).not.toHaveBeenCalled();
    });

    it('uses the shared scroll discovery function before retrying a lazy target', async () => {
      const button = document.createElement('button');
      button.id = 'lazy-target';
      document.body.appendChild(button);
      (querySelectorAllEnhanced as jest.Mock)
        .mockReturnValueOnce({ elements: [], usedFallback: false })
        .mockReturnValue({ elements: [button], usedFallback: false });
      (scrollUntilElementFound as jest.Mock).mockResolvedValue(button);
      mockNavigationManager.highlightWithComment = jest.fn().mockImplementation(async () => {
        button.click();
      });

      const result = await guidedHandler.executeGuidedStep(
        {
          targetAction: 'highlight',
          refTarget: '#lazy-target',
          lazyRender: true,
          scrollContainer: '.dashboard-scroll',
        },
        0,
        1,
        100
      );

      expect(result).toBe('completed');
      expect(scrollUntilElementFound).toHaveBeenCalledWith(
        '#lazy-target',
        expect.objectContaining({
          scrollContainerSelector: '.dashboard-scroll',
          deadlineMs: expect.any(Number),
        })
      );
    });

    it('prevents a navigation expansion from mutating after timeout', async () => {
      jest.useFakeTimers();
      try {
        const navButton = document.createElement('button');
        const refTarget = "a[data-testid='data-testid Nav menu item'][href='/alerting/list']";
        mockNavigationManager.expandParentNavigationSection = jest.fn(
          (_href: string, signal?: AbortSignal) =>
            new Promise<boolean>((resolve) => {
              setTimeout(() => {
                if (!signal?.aborted) {
                  navButton.click();
                }
                resolve(!signal?.aborted);
              }, 50);
            })
        );
        const clickSpy = jest.spyOn(navButton, 'click');

        const execution = guidedHandler.executeGuidedStep({ targetAction: 'highlight', refTarget }, 0, 1, 10);
        await jest.advanceTimersByTimeAsync(10);
        await expect(execution).resolves.toBe('timeout');
        await jest.advanceTimersByTimeAsync(50);

        expect(clickSpy).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('settles cancelled immediately during target retry without pending work', async () => {
      jest.useFakeTimers();
      try {
        (querySelectorAllEnhanced as jest.Mock).mockReturnValue({ elements: [], usedFallback: false });
        const execution = guidedHandler.executeGuidedStep(
          { targetAction: 'highlight', refTarget: '#missing-target' },
          0,
          1,
          30000
        );
        for (let i = 0; i < 5; i++) {
          await Promise.resolve();
        }
        expect(querySelectorAllEnhanced).toHaveBeenCalled();
        guidedHandler.cancel();

        await expect(execution).resolves.toBe('cancelled');
        expect(jest.getTimerCount()).toBe(0);
        expect((guidedHandler as any).activeListeners).toHaveLength(0);
        expect((guidedHandler as any).pendingTimeouts).toHaveLength(0);
        expect((guidedHandler as any).pendingIntervals).toHaveLength(0);
      } finally {
        jest.useRealTimers();
      }
    });

    it('removes a comment box and active class created after timeout', async () => {
      jest.useFakeTimers();
      try {
        const target = document.createElement('button');
        document.body.appendChild(target);
        (querySelectorAllEnhanced as jest.Mock).mockReturnValue({ elements: [target], usedFallback: false });
        mockNavigationManager.clearAllHighlights = jest.fn(() => {
          document.querySelectorAll('.interactive-comment-box').forEach((element) => element.remove());
        });
        mockNavigationManager.highlightWithComment = jest.fn(
          (_element: HTMLElement) =>
            new Promise<HTMLElement>((resolve) => {
              setTimeout(() => {
                const commentBox = document.createElement('div');
                commentBox.className = 'interactive-comment-box';
                document.body.appendChild(commentBox);
                target.classList.add('interactive-guided-active');
                resolve(target);
              }, 50);
            })
        );

        const execution = guidedHandler.executeGuidedStep(
          { targetAction: 'highlight', refTarget: '#late-target' },
          0,
          1,
          10
        );
        await jest.advanceTimersByTimeAsync(10);
        await expect(execution).resolves.toBe('timeout');
        await jest.advanceTimersByTimeAsync(50);

        expect(document.querySelector('.interactive-comment-box')).toBeNull();
        expect(target).not.toHaveClass('interactive-guided-active');
      } finally {
        jest.useRealTimers();
      }
    });

    it.each(['button', 'highlight'] as const)('preserves successful %s behavior', async (targetAction) => {
      const button = document.createElement('button');
      button.id = `${targetAction}-target`;
      document.body.appendChild(button);
      (querySelectorAllEnhanced as jest.Mock).mockReturnValue({ elements: [button], usedFallback: false });
      mockNavigationManager.highlightWithComment = jest.fn().mockImplementation(async () => {
        button.click();
      });

      const result = await guidedHandler.executeGuidedStep(
        { targetAction, refTarget: `#${targetAction}-target` },
        0,
        1,
        100
      );

      expect(result).toBe('completed');
    });

    it('preserves successful hover behavior', async () => {
      const target = document.createElement('div');
      document.body.appendChild(target);
      (querySelectorAllEnhanced as jest.Mock).mockReturnValue({ elements: [target], usedFallback: false });
      mockNavigationManager.highlightWithComment = jest.fn().mockImplementation(async () => {
        target.dispatchEvent(new MouseEvent('mouseenter'));
      });

      const result = await guidedHandler.executeGuidedStep(
        { targetAction: 'hover', refTarget: '#hover-target' },
        0,
        1,
        1000
      );

      expect(result).toBe('completed');
    });

    it('preserves successful formfill behavior', async () => {
      const input = document.createElement('input');
      input.value = 'ready';
      document.body.appendChild(input);
      (querySelectorAllEnhanced as jest.Mock).mockReturnValue({ elements: [input], usedFallback: false });

      const result = await guidedHandler.executeGuidedStep(
        { targetAction: 'formfill', refTarget: '#form-target' },
        0,
        1,
        2000
      );

      expect(result).toBe('completed');
    });

    it('preserves successful noop behavior', async () => {
      const execution = guidedHandler.executeGuidedStep({ targetAction: 'noop' }, 0, 1, 1000);
      await Promise.resolve();
      document.dispatchEvent(new CustomEvent('guided-noop-continue', { detail: { stepIndex: 0 } }));

      await expect(execution).resolves.toBe('completed');
    });
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
      expect(mockNavigationManager.expandParentNavigationSection).toHaveBeenCalledWith(
        '/alerting/list',
        expect.anything()
      );
      expect(document.querySelector('button[aria-label="Expand section: Alerting"]')).toHaveAttribute(
        'aria-expanded',
        'true'
      );
      expect(document.querySelector(refTarget)).toBeInTheDocument();
      expect(mockNavigationManager.ensureNavigationOpen).toHaveBeenCalledWith(
        document.querySelector(refTarget),
        expect.anything()
      );
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

  describe('ActiveListener type safety', () => {
    it('should use EventTarget type for listener cleanup', () => {
      // This is a compile-time test - if the types are wrong, TypeScript will fail
      // We verify the handler can be created and cancelled without type errors
      const handler = new GuidedHandler(
        mockStateManager,
        mockNavigationManager,
        mockWaitForReactUpdates,
        mockCheckRequirements
      );
      handler.cancel();
      expect(handler).toBeDefined();
    });
  });
});
