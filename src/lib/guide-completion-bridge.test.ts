import type { LearningPath } from '../types/learning-paths.types';

const warnMock = jest.fn();

jest.mock('./logging', () => ({
  __esModule: true,
  logger: { warn: (...args: unknown[]) => warnMock(...args) },
}));

function loadBridge(): typeof import('./guide-completion-bridge') {
  jest.resetModules();
  return require('./guide-completion-bridge');
}

const pathUrl = 'https://grafana.com/docs/learning-journeys/basics/';

const path: LearningPath = {
  id: 'grafana-basics',
  title: 'Grafana basics',
  description: 'Learn the basics',
  guides: [],
  badgeId: 'basics-badge',
  url: pathUrl,
};

describe('guide completion bridge', () => {
  beforeEach(() => {
    warnMock.mockClear();
  });

  it('degrades to a safe default before learning-paths registers (entry code must never throw)', async () => {
    const bridge = loadBridge();

    await expect(bridge.markGuideCompleted('grafana-basics')).resolves.toBeUndefined();
    expect(bridge.findPathByUrl(pathUrl)).toBeUndefined();
    expect(warnMock).toHaveBeenCalledTimes(2);
  });

  it('forwards to the registered implementation', async () => {
    const bridge = loadBridge();
    const impl = {
      markGuideCompleted: jest.fn().mockResolvedValue(undefined),
      findPathByUrl: jest.fn().mockReturnValue(path),
    };
    bridge.registerGuideCompletionBridge(impl);

    await bridge.markGuideCompleted('grafana-basics');
    expect(bridge.findPathByUrl(pathUrl)).toBe(path);

    expect(impl.markGuideCompleted).toHaveBeenCalledWith('grafana-basics');
    expect(impl.findPathByUrl).toHaveBeenCalledWith(pathUrl);
    expect(warnMock).not.toHaveBeenCalled();
  });

  it('registering a second implementation replaces the first instead of dispatching to both', async () => {
    const bridge = loadBridge();
    const first = {
      markGuideCompleted: jest.fn().mockResolvedValue(undefined),
      findPathByUrl: jest.fn().mockReturnValue(undefined),
    };
    const second = {
      markGuideCompleted: jest.fn().mockResolvedValue(undefined),
      findPathByUrl: jest.fn().mockReturnValue(path),
    };

    bridge.registerGuideCompletionBridge(first);
    bridge.registerGuideCompletionBridge(second);

    await bridge.markGuideCompleted('grafana-basics');
    expect(bridge.findPathByUrl(pathUrl)).toBe(path);

    expect(second.markGuideCompleted).toHaveBeenCalledTimes(1);
    expect(second.findPathByUrl).toHaveBeenCalledTimes(1);
    expect(first.markGuideCompleted).not.toHaveBeenCalled();
    expect(first.findPathByUrl).not.toHaveBeenCalled();
  });
});
