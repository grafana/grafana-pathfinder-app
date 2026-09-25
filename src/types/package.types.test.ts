import {
  getPackageRenderType,
  getManifestTracks,
  getAllTrackGuideIds,
  getManifestMemberIds,
  FOUNDATIONS_TRACK_ID,
} from './package.types';

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

  // The reserved trackId and cross-track uniqueness checks also run in
  // ManifestJsonSchema's superRefine, which not every runtime loader
  // exercises — enforcing them here too makes them true on every path.
  it('drops a track that reuses the reserved Foundations trackId', () => {
    expect(
      getManifestTracks({
        tracks: [
          { trackId: FOUNDATIONS_TRACK_ID, label: 'Foundations again', guides: ['a'] },
          { trackId: 'builder', label: 'Builder', guides: ['b'] },
        ],
      })
    ).toEqual([{ trackId: 'builder', label: 'Builder', guides: ['b'] }]);
  });

  it('drops a duplicate trackId, keeping the first occurrence', () => {
    expect(
      getManifestTracks({
        tracks: [
          { trackId: 'builder', label: 'Builder', guides: ['a'] },
          { trackId: 'builder', label: 'Builder (duplicate)', guides: ['b'] },
        ],
      })
    ).toEqual([{ trackId: 'builder', label: 'Builder', guides: ['a'] }]);
  });

  // Empty guides is rejected at authoring time by ManifestJsonSchema's Rule
  // 5, which not every runtime loader exercises either — enforced here too,
  // the same way the checks above are.
  it('drops a track with an empty guides list', () => {
    expect(
      getManifestTracks({
        tracks: [
          { trackId: 'builder', label: 'Builder', guides: [] },
          { trackId: 'seller', label: 'Seller', guides: ['a'] },
        ],
      })
    ).toEqual([{ trackId: 'seller', label: 'Seller', guides: ['a'] }]);
  });

  it('drops a track with an empty trackId', () => {
    expect(
      getManifestTracks({
        tracks: [
          { trackId: '', label: 'Builder', guides: ['a'] },
          { trackId: 'seller', label: 'Seller', guides: ['a'] },
        ],
      })
    ).toEqual([{ trackId: 'seller', label: 'Seller', guides: ['a'] }]);
  });

  it('drops a track with an empty label', () => {
    expect(
      getManifestTracks({
        tracks: [
          { trackId: 'builder', label: '', guides: ['a'] },
          { trackId: 'seller', label: 'Seller', guides: ['a'] },
        ],
      })
    ).toEqual([{ trackId: 'seller', label: 'Seller', guides: ['a'] }]);
  });

  it('drops a track with an empty-string guide entry inside an otherwise non-empty guides array', () => {
    expect(
      getManifestTracks({
        tracks: [
          { trackId: 'builder', label: 'Builder', guides: ['a', ''] },
          { trackId: 'seller', label: 'Seller', guides: ['a'] },
        ],
      })
    ).toEqual([{ trackId: 'seller', label: 'Seller', guides: ['a'] }]);
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
