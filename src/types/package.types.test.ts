import { getPackageRenderType, getManifestTracks, getAllTrackGuideIds, getManifestMemberIds } from './package.types';

describe('getPackageRenderType', () => {
  it('returns interactive for guide-type manifests', () => {
    expect(getPackageRenderType({ type: 'guide' })).toBe('interactive');
  });

  it('returns learning-journey for path-type manifests', () => {
    expect(getPackageRenderType({ type: 'path' })).toBe('learning-journey');
  });

  it('returns learning-journey for journey-type manifests', () => {
    expect(getPackageRenderType({ type: 'journey' })).toBe('learning-journey');
  });

  it('returns interactive when manifest is undefined', () => {
    expect(getPackageRenderType(undefined)).toBe('interactive');
  });

  it('returns interactive when manifest has no type field', () => {
    expect(getPackageRenderType({ id: 'some-package' })).toBe('interactive');
  });

  it('returns interactive when manifest.type is not a string', () => {
    expect(getPackageRenderType({ type: 42 })).toBe('interactive');
  });

  it('returns interactive for unrecognized manifest.type values', () => {
    expect(getPackageRenderType({ type: 'unknown-type' })).toBe('interactive');
  });
});

describe('getManifestTracks', () => {
  it('returns an empty array when the source is undefined or null', () => {
    expect(getManifestTracks(undefined)).toEqual([]);
    expect(getManifestTracks(null)).toEqual([]);
  });

  it('returns an empty array when tracks is missing or not an array', () => {
    expect(getManifestTracks({})).toEqual([]);
    expect(getManifestTracks({ tracks: 'not-an-array' })).toEqual([]);
  });

  it('returns well-formed tracks unchanged', () => {
    const tracks = [
      { trackId: 'builder', label: 'Builder', guides: ['a', 'b'] },
      { trackId: 'seller', label: 'Seller', guides: ['c'] },
    ];
    expect(getManifestTracks({ tracks })).toEqual(tracks);
  });

  it('drops a malformed track entry rather than throwing', () => {
    expect(
      getManifestTracks({
        tracks: [
          { trackId: 'builder', label: 'Builder', guides: ['a'] },
          { trackId: 'seller', label: 'Seller' /* missing guides */ },
          { trackId: 'dev', guides: ['x'] /* missing label */ },
          'not-an-object',
          { trackId: 'broken', label: 'Broken', guides: ['a', 7] /* non-string guide */ },
        ],
      })
    ).toEqual([{ trackId: 'builder', label: 'Builder', guides: ['a'] }]);
  });
});

describe('getAllTrackGuideIds', () => {
  it('flattens every track guide, preserving declared order', () => {
    const tracks = [
      { trackId: 'builder', label: 'Builder', guides: ['a', 'b'] },
      { trackId: 'seller', label: 'Seller', guides: ['c'] },
    ];
    expect(getAllTrackGuideIds(tracks)).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty array for no tracks', () => {
    expect(getAllTrackGuideIds([])).toEqual([]);
  });
});

describe('getManifestMemberIds', () => {
  it('returns an empty array when the source is undefined or null', () => {
    expect(getManifestMemberIds(undefined)).toEqual([]);
    expect(getManifestMemberIds(null)).toEqual([]);
  });

  it('returns milestones alone when there are no tracks', () => {
    expect(getManifestMemberIds({ milestones: ['a', 'b'] })).toEqual(['a', 'b']);
  });

  it('unions milestones and every track guide, deduplicated', () => {
    const result = getManifestMemberIds({
      milestones: ['a', 'b'],
      tracks: [
        { trackId: 'builder', label: 'Builder', guides: ['b', 'c'] },
        { trackId: 'seller', label: 'Seller', guides: ['d'] },
      ],
    });
    expect(result).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns only track guides when milestones is absent', () => {
    const result = getManifestMemberIds({
      tracks: [{ trackId: 'builder', label: 'Builder', guides: ['a', 'b'] }],
    });
    expect(result).toEqual(['a', 'b']);
  });
});
