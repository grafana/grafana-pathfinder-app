import { getCompatibilityGuideId, registerCompatibilityGuideId, resetGuideIdentityForTests } from './guide-identity';

describe('guide-identity', () => {
  beforeEach(() => {
    resetGuideIdentityForTests();
  });

  it('resolves the registered guide id', () => {
    registerCompatibilityGuideId('learning-journeys-alerting');
    expect(getCompatibilityGuideId()).toBe('learning-journeys-alerting');
  });

  it('resolves the empty string when nothing has registered', () => {
    expect(getCompatibilityGuideId()).toBe('');
  });

  it('never resolves to a shared sentinel bucket', () => {
    expect(getCompatibilityGuideId()).not.toBe('default');
  });

  it('publishes no window global', () => {
    registerCompatibilityGuideId('guide-a');
    expect((window as any).__DocsPluginGuideId).toBeUndefined();
  });

  it('lets the most recent registration win', () => {
    registerCompatibilityGuideId('guide-a');
    registerCompatibilityGuideId('guide-b');
    expect(getCompatibilityGuideId()).toBe('guide-b');
  });

  it('restores the previous registration on release', () => {
    registerCompatibilityGuideId('guide-a');
    const releaseB = registerCompatibilityGuideId('guide-b');
    releaseB();
    expect(getCompatibilityGuideId()).toBe('guide-a');
  });

  it('keeps the top registration when an older one is released first', () => {
    const releaseA = registerCompatibilityGuideId('guide-a');
    registerCompatibilityGuideId('guide-b');
    releaseA();
    expect(getCompatibilityGuideId()).toBe('guide-b');
  });

  it('resolves the empty string when the last registration is released', () => {
    const release = registerCompatibilityGuideId('guide-a');
    release();
    expect(getCompatibilityGuideId()).toBe('');
  });

  it('tolerates a release being called twice', () => {
    registerCompatibilityGuideId('guide-a');
    const releaseB = registerCompatibilityGuideId('guide-b');
    releaseB();
    releaseB();
    expect(getCompatibilityGuideId()).toBe('guide-a');
  });

  it('resetGuideIdentityForTests drops every registration', () => {
    registerCompatibilityGuideId('guide-a');
    registerCompatibilityGuideId('guide-b');
    resetGuideIdentityForTests();
    expect(getCompatibilityGuideId()).toBe('');
  });
});
