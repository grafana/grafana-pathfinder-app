import { resolveEffectiveTestMode } from './pr-tester-mode';

describe('resolveEffectiveTestMode', () => {
  it('clamps a stale path mode to single when the PR has no path package', () => {
    expect(resolveEffectiveTestMode('path', { manifestsLoading: false, hasAnyPathPackage: false })).toBe('single');
  });

  it('keeps path mode when the PR actually has a path package', () => {
    expect(resolveEffectiveTestMode('path', { manifestsLoading: false, hasAnyPathPackage: true })).toBe('path');
  });

  it('does not clamp while manifests are still loading', () => {
    expect(resolveEffectiveTestMode('path', { manifestsLoading: true, hasAnyPathPackage: false })).toBe('path');
  });

  it('leaves single mode untouched', () => {
    expect(resolveEffectiveTestMode('single', { manifestsLoading: false, hasAnyPathPackage: false })).toBe('single');
  });

  it('leaves all mode untouched even without a path package', () => {
    expect(resolveEffectiveTestMode('all', { manifestsLoading: false, hasAnyPathPackage: false })).toBe('all');
  });
});
