/**
 * Full-screen handoff coverage lives here so the hook is exercised with the
 * real panel-mode timing. This suite covers the handoff event payload, the
 * completion guard applied to the handler data, and suppressed outcomes.
 */

import { renderHook, act } from '@testing-library/react';
import { useInteractiveElements } from './interactive.hook';
import { REQUEST_SIDEBAR_HANDOFF_EVENT } from '../lib/event-names';

jest.mock('../lib/faro', () => ({
  withFaroUserAction: jest.fn((_name: string, _attributes: unknown, work: () => unknown) => work()),
  USER_ACTION_TIMEOUT_LONG_MS: 600000,
}));

const publishMock = jest.fn();
jest.mock('@grafana/runtime', () => ({
  getAppEvents: () => ({ publish: publishMock }),
  locationService: { push: jest.fn() },
}));

// global-state/panel-mode is intentionally NOT mocked here — this suite needs
// its real requestSidebarHandoffAndWait timing.

jest.mock('../requirements-manager', () => {
  const checkRequirements = jest.fn();
  const checkPostconditions = jest.fn();
  return {
    checkRequirements,
    checkPostconditions,
    useGuideRequirements: () => ({ checkRequirements, checkPostconditions }),
    RequirementsCheckOptions: jest.fn(),
  };
});

// Records when the (mocked) handler actually runs, so ordering against the
// real handoff timing can be asserted.
const handlerCallOrder: string[] = [];
jest.mock('./action-handlers', () => ({
  FocusHandler: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue(undefined),
  })),
  ButtonHandler: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockImplementation(async () => {
      handlerCallOrder.push('handler-executed');
    }),
  })),
  NavigateHandler: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue(undefined),
  })),
  FormFillHandler: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue(undefined),
  })),
  HoverHandler: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue(undefined),
  })),
  GuidedHandler: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue(undefined),
    executeGuidedStep: jest.fn().mockResolvedValue('completed'),
    cancel: jest.fn(),
  })),
  PopoutHandler: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('./interactive-state-manager', () => ({
  InteractiveStateManager: jest.fn().mockImplementation(() => ({
    setState: jest.fn(),
    handleError: jest.fn(),
  })),
}));

jest.mock('./navigation-manager', () => ({
  NavigationManager: jest.fn().mockImplementation(() => ({
    ensureNavigationOpen: jest.fn().mockResolvedValue(undefined),
    ensureElementVisible: jest.fn().mockResolvedValue(undefined),
    highlight: jest.fn().mockResolvedValue(undefined),
    fixNavigationRequirements: jest.fn().mockResolvedValue(undefined),
    openAndDockNavigation: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('./sequence-manager', () => ({
  SequenceManager: jest.fn().mockImplementation(() => ({
    runInteractiveSequence: jest.fn().mockResolvedValue('completed'),
    runStepByStepSequence: jest.fn().mockResolvedValue('completed'),
  })),
}));

jest.mock('../lib/dom', () => ({
  extractInteractiveDataFromElement: jest.fn(),
  findButtonByText: jest.fn().mockReturnValue([]),
  querySelectorAllEnhanced: jest.fn().mockReturnValue({ elements: [], usedFallback: false, originalSelector: '' }),
  resolveSelector: jest.fn((selector: string) => selector),
}));

describe('executeInteractiveAction composed with the real requestSidebarHandoffAndWait timing', () => {
  let containerRef: React.RefObject<HTMLDivElement>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    handlerCallOrder.length = 0;
    publishMock.mockClear();
    // panelModeManager reads/writes localStorage directly (StorageKeys.PANEL_MODE).
    localStorage.clear();
    localStorage.setItem('grafana-pathfinder-app-panel-mode', 'fullscreen');
    containerRef = { current: document.createElement('div') };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not run the handler until pathfinder-sidebar-mounted fires and the settle delay elapses', async () => {
    const { result } = renderHook(() => useInteractiveElements({ containerRef }));
    const handoffListener = jest.fn();
    document.addEventListener(REQUEST_SIDEBAR_HANDOFF_EVENT, handoffListener as EventListener);

    let executePromise!: Promise<unknown>;
    act(() => {
      executePromise = result.current.executeInteractiveAction({
        targetAction: 'button',
        refTarget: 'test-target',
        buttonType: 'do',
        fullScreenFallbackLocation: '/connections',
      });
    });

    // Flush the microtask that registers the pathfinder-sidebar-mounted listener.
    await Promise.resolve();
    expect(handlerCallOrder).toEqual([]);

    window.dispatchEvent(new CustomEvent('pathfinder-sidebar-mounted'));
    // Settle delay (300ms) hasn't elapsed yet — handler still must not run.
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    expect(handlerCallOrder).toEqual([]);

    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    await executePromise;
    document.removeEventListener(REQUEST_SIDEBAR_HANDOFF_EVENT, handoffListener as EventListener);

    expect(handlerCallOrder).toEqual(['handler-executed']);
    expect(handoffListener).toHaveBeenCalledTimes(1);
    expect((handoffListener.mock.calls[0]![0] as CustomEvent).detail).toEqual({ targetPath: '/connections' });

    const { ButtonHandler } = require('./action-handlers');
    const buttonHandlerInstance = ButtonHandler.mock.results.at(-1)!.value;
    expect(buttonHandlerInstance.execute.mock.calls[0]![0].skipCompletionOnEmptyTarget).toBe(true);
  });

  it('falls through to the handler via the safety timeout when the mount event never fires', async () => {
    const { result } = renderHook(() => useInteractiveElements({ containerRef }));

    let executePromise!: Promise<unknown>;
    act(() => {
      executePromise = result.current.executeInteractiveAction({
        targetAction: 'button',
        refTarget: 'test-target',
        buttonType: 'do',
      });
    });

    await Promise.resolve();
    expect(handlerCallOrder).toEqual([]);

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    await executePromise;

    expect(handlerCallOrder).toEqual(['handler-executed']);
  });

  it('returns error when a handler suppresses completion', async () => {
    localStorage.setItem('grafana-pathfinder-app-panel-mode', 'sidebar');
    const { ButtonHandler } = require('./action-handlers');
    ButtonHandler.mockImplementationOnce(() => ({
      execute: jest.fn().mockImplementation(async (data: { completionSuppressed?: boolean }) => {
        data.completionSuppressed = true;
      }),
    }));
    const { result } = renderHook(() => useInteractiveElements({ containerRef }));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.executeInteractiveAction({
        targetAction: 'button',
        refTarget: 'test-target',
        buttonType: 'do',
      });
    });

    expect(outcome).toBe('error');
  });
});
