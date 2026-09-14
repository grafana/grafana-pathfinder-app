import { installLiveTabExecutor, resetLiveTabExecutorForTests, DEFAULT_PACING } from './live-tab-executor';
import { GuidedHandler } from '../../interactive-engine';
import { guideResponseStorage, sectionDoneStorage } from '../../lib/user-storage';
import { FakeCrossTabTransport } from '../../test-utils/fake-cross-tab-transport';
import type { CrossTabPayload, StepCommandMessage } from '../../types/cross-tab.types';
import type { GuidedAction } from '../../types/interactive-actions.types';

jest.mock('../../lib/user-storage', () => ({
  ...jest.requireActual('../../lib/user-storage'),
  guideResponseStorage: { getResponse: jest.fn() },
  sectionDoneStorage: { get: jest.fn() },
}));

jest.mock('../../global-state/content-key', () => ({
  ...jest.requireActual('../../global-state/content-key'),
  getContentKey: jest.fn(() => 'ambient-content'),
}));

jest.mock('../../global-state/guide-identity', () => ({
  ...jest.requireActual('../../global-state/guide-identity'),
  getCompatibilityGuideId: jest.fn(() => 'ambient-guide'),
}));

jest.mock('../../interactive-engine/navigation-manager', () => ({
  NavigationManager: jest.fn(() => ({
    clearAllHighlights: jest.fn(() => {
      document.querySelectorAll('.interactive-comment-box').forEach((box) => box.remove());
    }),
  })),
}));

jest.mock('../../styles/interactive.styles', () => ({
  ...jest.requireActual('../../styles/interactive.styles'),
  addGlobalInteractiveStyles: jest.fn(),
  updateInteractiveThemeColors: jest.fn(),
}));

jest.mock('../../lib/faro', () => ({
  withFaroUserAction: jest.fn((_name: string, _attributes: unknown, work: () => unknown) => work()),
  setFaroUserActionAttributes: jest.fn(),
  USER_ACTION_TIMEOUT_LONG_MS: 600_000,
}));

const openAuthGate = {
  verifySignedMessage: async () => true,
  setPendingChallenge: () => undefined,
  setOwnLiveTabId: () => undefined,
  onSessionAccepted: () => () => undefined,
};

const getResponse = jest.mocked(guideResponseStorage.getResponse);
const getSectionDone = jest.mocked(sectionDoneStorage.get);

function command(internalActions: GuidedAction[], stepTimeout?: number): StepCommandMessage {
  return {
    source: 'pathfinder',
    senderId: 'controller',
    timestamp: 0,
    kind: 'step-command',
    phase: 'do',
    stepId: 'guided',
    runId: 'current-run',
    action: {
      targetAction: 'guided',
      refTarget: '',
      internalActions,
      stepTimeout,
      guideId: 'remote-guide',
      contentKey: 'remote-content',
    },
  };
}

describe('live executor with the real guided handler', () => {
  let transport: FakeCrossTabTransport;
  let uninstall: () => void;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    jest.clearAllMocks();
    resetLiveTabExecutorForTests();
    getResponse.mockResolvedValue(undefined);
    getSectionDone.mockResolvedValue(null);
    transport = new FakeCrossTabTransport('live');
    uninstall = installLiveTabExecutor(transport, DEFAULT_PACING, openAuthGate);
  });

  afterEach(async () => {
    uninstall();
    await jest.advanceTimersByTimeAsync(0);
    document.body.replaceChildren();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function replies(kind: 'step-progress' | 'step-complete') {
    return (transport.postedMessages as CrossTabPayload[]).filter((message) => message.kind === kind);
  }

  it('uses the remote guide and content scope for authored requirements', async () => {
    getResponse.mockImplementation(async (guideId) => guideId === 'remote-guide');
    getSectionDone.mockImplementation(async (contentKey) => (contentKey === 'remote-content' ? true : null));
    transport.emit(
      command([{ targetAction: 'noop', requirements: ['var-accepted:true', 'section-completed:intro'] }], 45_000)
    );
    await jest.advanceTimersByTimeAsync(0);

    expect(getResponse).toHaveBeenCalledWith('remote-guide', 'accepted');
    expect(getSectionDone).toHaveBeenCalledWith('remote-content', 'section-intro');
    const box = document.querySelector('.interactive-comment-box');
    expect(box).toHaveAttribute('data-test-substep-index', '0');
    expect(box).toHaveAttribute('data-test-substep-skippable', 'false');
    expect(replies('step-complete')).toEqual([]);

    (box!.querySelector('button') as HTMLButtonElement).click();
    expect(replies('step-progress')).toContainEqual(
      expect.objectContaining({
        substepResults: [{ index: 0, action: 'noop', status: 'completed', durationMs: 0 }],
      })
    );
    await jest.advanceTimersByTimeAsync(0);
    expect(replies('step-complete')).toEqual([
      expect.objectContaining({
        ok: true,
        substepResults: [{ index: 0, action: 'noop', status: 'completed', durationMs: 0 }],
      }),
    ]);
  });

  it('preserves consecutive skips without borrowing answers or section completion from the live tab', async () => {
    getResponse.mockImplementation(async (guideId) => guideId === 'ambient-guide');
    getSectionDone.mockImplementation(async (contentKey) => (contentKey === 'ambient-content' ? true : null));
    const localSection = document.createElement('section');
    localSection.id = 'section-intro';
    localSection.className = 'completed';
    document.body.appendChild(localSection);
    transport.emit(
      command([
        { targetAction: 'noop', requirements: 'var-accepted:true', isSkippable: true },
        { targetAction: 'noop', requirements: 'section-completed:intro', isSkippable: true },
        { targetAction: 'noop' },
      ])
    );
    await jest.advanceTimersByTimeAsync(0);

    const skips = [
      { index: 0, action: 'noop', status: 'skipped', durationMs: 0 },
      { index: 1, action: 'noop', status: 'skipped', durationMs: 0 },
    ];
    expect(replies('step-progress')).toContainEqual(expect.objectContaining({ index: 2, substepResults: skips }));
    const box = document.querySelector('.interactive-comment-box');
    expect(box).toHaveAttribute('data-test-substep-index', '2');
    (box!.querySelector('button') as HTMLButtonElement).click();
    await jest.advanceTimersByTimeAsync(0);
    expect(replies('step-complete')).toEqual([
      expect.objectContaining({
        ok: true,
        substepResults: [...skips, { index: 2, action: 'noop', status: 'completed', durationMs: 0 }],
      }),
    ]);
  });

  it.each([
    [30_000, 30_000],
    [45_000, 45_000],
    [60_000, 60_000],
    [undefined, 120_000],
  ])('bounds an unmet requirement by the authored timeout %s', async (stepTimeout, effectiveTimeout) => {
    transport.emit(command([{ targetAction: 'noop', requirements: 'var-accepted:true' }], stepTimeout));
    await jest.advanceTimersByTimeAsync(effectiveTimeout! - 1);
    expect(replies('step-complete')).toEqual([]);
    expect(document.querySelector('.interactive-comment-box')).toBeNull();
    await jest.advanceTimersByTimeAsync(1);
    expect(replies('step-complete')).toEqual([
      expect.objectContaining({
        ok: false,
        substepResults: [{ index: 0, action: 'noop', status: 'timeout', durationMs: effectiveTimeout }],
      }),
    ]);
  });

  it('cancels a pending requirement before teardown and ignores its later result', async () => {
    const execute = jest.spyOn(GuidedHandler.prototype, 'executeGuidedStep');
    let resolveRequirement!: (value: boolean) => void;
    getResponse.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRequirement = resolve;
        })
    );
    transport.emit(command([{ targetAction: 'noop', requirements: 'var-accepted:true' }, { targetAction: 'noop' }]));
    await jest.advanceTimersByTimeAsync(0);
    uninstall();
    expect(replies('step-progress')).toContainEqual(
      expect.objectContaining({
        substepResults: [{ index: 0, action: 'noop', status: 'cancelled', durationMs: 0 }],
      })
    );
    resolveRequirement(true);
    await jest.advanceTimersByTimeAsync(0);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.interactive-comment-box')).toBeNull();
  });
});
