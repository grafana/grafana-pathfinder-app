import type { ContentFetchResult, Milestone } from '../types/content.types';
import type { ResolvedNavLink } from '../types/context.types';

const warnMock = jest.fn();

jest.mock('./logging', () => ({
  __esModule: true,
  logger: { warn: (...args: unknown[]) => warnMock(...args) },
}));

function loadBridge(): typeof import('./learning-journey-content-bridge') {
  jest.resetModules();
  return require('./learning-journey-content-bridge');
}

const fetched: ContentFetchResult = { content: null, statusCode: 204 };
const milestones: Milestone[] = [{ number: 1, title: 'First', url: 'https://example.com/m1', isActive: true }];
const navLinks: ResolvedNavLink[] = [{ packageId: 'pkg-a', title: 'Package A', contentUrl: 'https://example.com/a' }];

function makeImpl() {
  return {
    fetchContent: jest.fn().mockResolvedValue(fetched),
    getJourneyCompletionPercentageAsync: jest.fn().mockResolvedValue(42),
    resolvePackageMilestones: jest.fn().mockResolvedValue(milestones),
    resolvePackageNavLinks: jest.fn().mockResolvedValue(navLinks),
    derivePathSlug: jest.fn().mockReturnValue('grafana-basics'),
  };
}

describe('learning journey content bridge', () => {
  beforeEach(() => {
    warnMock.mockClear();
  });

  it('degrades to a safe default before docs-retrieval registers (entry code must never throw)', async () => {
    const bridge = loadBridge();

    await expect(bridge.fetchContent('https://example.com/a')).resolves.toEqual({
      content: null,
      error: 'docs-retrieval content bridge not registered',
      errorType: 'other',
    });
    await expect(bridge.getJourneyCompletionPercentageAsync('https://example.com/a')).resolves.toBe(0);
    await expect(bridge.resolvePackageMilestones(['m1'])).resolves.toEqual([]);
    await expect(bridge.resolvePackageNavLinks(['pkg-a'])).resolves.toEqual([]);
    expect(bridge.derivePathSlug('grafana-basics-lj')).toBe('grafana-basics-lj');

    expect(warnMock).toHaveBeenCalledTimes(5);
  });

  it('forwards to the registered implementation', async () => {
    const bridge = loadBridge();
    const impl = makeImpl();
    bridge.registerLearningJourneyContentBridge(impl);

    await expect(bridge.fetchContent('https://example.com/a', { timeout: 500 })).resolves.toBe(fetched);
    await expect(bridge.getJourneyCompletionPercentageAsync('https://example.com/a')).resolves.toBe(42);
    await expect(bridge.resolvePackageMilestones(['m1'], 'grafana-basics')).resolves.toBe(milestones);
    await expect(bridge.resolvePackageNavLinks(['pkg-a'])).resolves.toBe(navLinks);
    expect(bridge.derivePathSlug('grafana-basics-lj')).toBe('grafana-basics');

    expect(impl.fetchContent).toHaveBeenCalledWith('https://example.com/a', { timeout: 500 });
    expect(impl.getJourneyCompletionPercentageAsync).toHaveBeenCalledWith('https://example.com/a');
    expect(impl.resolvePackageMilestones).toHaveBeenCalledWith(['m1'], 'grafana-basics');
    expect(impl.resolvePackageNavLinks).toHaveBeenCalledWith(['pkg-a']);
    expect(impl.derivePathSlug).toHaveBeenCalledWith('grafana-basics-lj');
    expect(warnMock).not.toHaveBeenCalled();
  });

  it('registering a second implementation replaces the first instead of dispatching to both', async () => {
    const bridge = loadBridge();
    const first = makeImpl();
    const second = makeImpl();
    second.derivePathSlug.mockReturnValue('second-slug');

    bridge.registerLearningJourneyContentBridge(first);
    bridge.registerLearningJourneyContentBridge(second);

    await bridge.fetchContent('https://example.com/a');
    await bridge.getJourneyCompletionPercentageAsync('https://example.com/a');
    await bridge.resolvePackageMilestones(['m1']);
    await bridge.resolvePackageNavLinks(['pkg-a']);
    expect(bridge.derivePathSlug('grafana-basics-lj')).toBe('second-slug');

    expect(second.fetchContent).toHaveBeenCalledTimes(1);
    expect(second.getJourneyCompletionPercentageAsync).toHaveBeenCalledTimes(1);
    expect(second.resolvePackageMilestones).toHaveBeenCalledTimes(1);
    expect(second.resolvePackageNavLinks).toHaveBeenCalledTimes(1);
    expect(second.derivePathSlug).toHaveBeenCalledTimes(1);

    expect(first.fetchContent).not.toHaveBeenCalled();
    expect(first.getJourneyCompletionPercentageAsync).not.toHaveBeenCalled();
    expect(first.resolvePackageMilestones).not.toHaveBeenCalled();
    expect(first.resolvePackageNavLinks).not.toHaveBeenCalled();
    expect(first.derivePathSlug).not.toHaveBeenCalled();
  });
});
