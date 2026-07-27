/**
 * Tests for `resolveCompletionIdentity` — the manifest-keyed identity rule
 * shared with the Custom Guide Packages RFC: `(guideSource, guideId) =
 * (manifest.repository, manifest.id)`, never derived from a loader URL.
 */
import { resolveCompletionIdentity, manifestGuideId, manifestGuideSource } from './completion-identity';

describe('resolveCompletionIdentity', () => {
  it('keys on manifest.repository / manifest.id when present', () => {
    expect(
      resolveCompletionIdentity({
        packageManifest: { id: 'fe-alerting-01', repository: 'app-platform', type: 'guide' },
        fallbackId: 'ignored',
      })
    ).toEqual({ guideSource: 'app-platform', guideId: 'fe-alerting-01' });
  });

  it('uses the recommendation-level repository when the manifest lacks its own (V1PackageManifest)', () => {
    expect(
      resolveCompletionIdentity({
        packageManifest: { id: 'linux-01', type: 'guide' },
        repository: 'app-platform',
        fallbackId: 'ignored',
      })
    ).toEqual({ guideSource: 'app-platform', guideId: 'linux-01' });
  });

  it('falls back to the bundled slug + source when no manifest is present', () => {
    expect(
      resolveCompletionIdentity({
        fallbackId: 'first-dashboard',
        fallbackSource: 'bundled',
      })
    ).toEqual({ guideSource: 'bundled', guideId: 'first-dashboard' });
  });

  it('defaults guideSource to interactive-tutorials when nothing resolves one', () => {
    expect(resolveCompletionIdentity({ fallbackId: 'x' })).toEqual({
      guideSource: 'interactive-tutorials',
      guideId: 'x',
    });
  });

  it('never derives identity from a loader URL — a backend-guide: fallbackId is passed through verbatim, not slugged', () => {
    // The scheme leaves the completion path: with a real manifest the URL is
    // irrelevant; identity comes from the manifest.
    expect(
      resolveCompletionIdentity({
        packageManifest: { id: 'fe-alerting-01', repository: 'app-platform' },
        fallbackId: 'backend-guide:fe-alerting-01',
      })
    ).toEqual({ guideSource: 'app-platform', guideId: 'fe-alerting-01' });
  });

  it('ignores non-string / empty manifest fields and falls back', () => {
    expect(
      resolveCompletionIdentity({
        packageManifest: { id: '', repository: 42 as unknown as string },
        fallbackId: 'slug',
        fallbackSource: 'bundled',
      })
    ).toEqual({ guideSource: 'bundled', guideId: 'slug' });
  });
});

describe('manifestGuideId', () => {
  it('returns the manifest id when present and non-empty', () => {
    expect(manifestGuideId({ id: 'fe-alerting-01' })).toBe('fe-alerting-01');
  });

  it('returns undefined for a missing manifest, missing id, empty id, or non-string id', () => {
    expect(manifestGuideId(undefined)).toBeUndefined();
    expect(manifestGuideId({})).toBeUndefined();
    expect(manifestGuideId({ id: '' })).toBeUndefined();
    expect(manifestGuideId({ id: 42 })).toBeUndefined();
  });
});

describe('manifestGuideSource', () => {
  it('returns only a non-empty repository string', () => {
    expect(manifestGuideSource({ repository: 'app-platform' })).toBe('app-platform');
    expect(manifestGuideSource({ repository: '' })).toBeUndefined();
    expect(manifestGuideSource({ repository: 42 })).toBeUndefined();
    expect(manifestGuideSource()).toBeUndefined();
  });
});
