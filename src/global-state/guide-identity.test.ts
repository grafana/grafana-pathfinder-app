import { getCurrentGuideId, registerGuideId, resetGuideIdentityForTests } from './guide-identity';

describe('guide-identity', () => {
  beforeEach(() => {
    resetGuideIdentityForTests();
    delete (window as any).__DocsPluginGuideId;
  });

  it('resolves the registered guide id', () => {
    registerGuideId('learning-journeys-alerting');
    expect(getCurrentGuideId()).toBe('learning-journeys-alerting');
  });

  it('resolves the empty string when nothing has registered', () => {
    expect(getCurrentGuideId()).toBe('');
  });

  it('never resolves to a shared sentinel bucket', () => {
    expect(getCurrentGuideId()).not.toBe('default');
  });

  it('falls back to the window global when no registration exists', () => {
    (window as any).__DocsPluginGuideId = 'guide-from-outside-the-tree';
    expect(getCurrentGuideId()).toBe('guide-from-outside-the-tree');
  });

  it('prefers a registration over the window global', () => {
    (window as any).__DocsPluginGuideId = 'stale-guide';
    registerGuideId('current-guide');
    expect(getCurrentGuideId()).toBe('current-guide');
  });

  it('mirrors the registered id to the window global', () => {
    registerGuideId('guide-a');
    expect((window as any).__DocsPluginGuideId).toBe('guide-a');
  });

  it('lets the most recent registration win', () => {
    registerGuideId('guide-a');
    registerGuideId('guide-b');
    expect(getCurrentGuideId()).toBe('guide-b');
  });

  it('restores the previous registration on release', () => {
    registerGuideId('guide-a');
    const releaseB = registerGuideId('guide-b');
    releaseB();
    expect(getCurrentGuideId()).toBe('guide-a');
    expect((window as any).__DocsPluginGuideId).toBe('guide-a');
  });

  it('keeps the top registration when an older one is released first', () => {
    const releaseA = registerGuideId('guide-a');
    registerGuideId('guide-b');
    releaseA();
    expect(getCurrentGuideId()).toBe('guide-b');
  });

  it('clears the mirrored global when the last registration is released', () => {
    const release = registerGuideId('guide-a');
    release();
    expect(getCurrentGuideId()).toBe('');
    expect((window as any).__DocsPluginGuideId).toBe('');
  });

  it('tolerates a release being called twice', () => {
    registerGuideId('guide-a');
    const releaseB = registerGuideId('guide-b');
    releaseB();
    releaseB();
    expect(getCurrentGuideId()).toBe('guide-a');
  });

  it('resetGuideIdentityForTests drops every registration', () => {
    registerGuideId('guide-a');
    registerGuideId('guide-b');
    resetGuideIdentityForTests();
    delete (window as any).__DocsPluginGuideId;
    expect(getCurrentGuideId()).toBe('');
  });
});
