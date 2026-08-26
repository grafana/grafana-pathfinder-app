/**
 * `interactive.hook.test.ts`'s "Full-screen sidebar handoff gate" suite mocks
 * `global-state/panel-mode` wholesale, so it only proves the gate calls
 * `requestSidebarHandoffAndWait` with the right arguments — never that the
 * gate actually blocks on the REAL timing (the `pathfinder-sidebar-mounted`
 * event + settle delay, or the safety timeout) before letting the handler
 * run. `panel-mode.test.ts` tests that timing in isolation, but never through
 * the hook's gate. This file uses the real `panel-mode.ts` module with fake
 * timers to prove the composition holds.
 */

import { renderHook, act } from '@testing-library/react';
import { useInteractiveElements } from './interactive.hook';

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

    expect(handlerCallOrder).toEqual(['handler-executed']);
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
});
