/**
 * Tests for highlighted-guide-utils
 *
 * Marker lifecycle (localStorage), page matching, synthetic featured-card builder.
 */

jest.mock('../../lib/storage-keys', () => ({
  StorageKeys: {
    HIGHLIGHTED_GUIDE_AUTO_OPEN_PREFIX: 'grafana-pathfinder-highlighted-guide-auto-open-',
    HIGHLIGHTED_GUIDE_RESET_PROCESSED_PREFIX: 'grafana-pathfinder-highlighted-guide-reset-processed-',
  },
}));

jest.mock('../openfeature', () => ({
  matchPathPattern: (pattern: string, path: string) => {
    if (pattern.endsWith('*')) {
      return path.startsWith(pattern.slice(0, -1));
    }
    return path === pattern || path === pattern + '/';
  },
}));

jest.mock('../find-doc-page', () => ({
  findDocPage: jest.fn((param: string) => {
    if (!param) {
      return null;
    }
    if (param.startsWith('bundled:')) {
      const id = param.slice('bundled:'.length);
      if (id === 'unknown') {
        return null;
      }
      return { type: 'docs-page', url: param, title: id };
    }
    if (param.startsWith('api:')) {
      const id = param.slice('api:'.length);
      return { type: 'docs-page', url: `backend-guide:${id}`, title: id };
    }
    if (param.startsWith('https://')) {
      if (param.includes('malicious')) {
        return null;
      }
      return { type: 'learning-journey', url: param, title: 'Remote' };
    }
    return null;
  }),
}));

import {
  buildSyntheticFeaturedRecommendation,
  clearHighlightedGuideMarkers,
  getHighlightedGuideMarkerKey,
  hasHighlightedGuideAutoOpened,
  markHighlightedGuideAutoOpened,
  matchesHighlightedGuidePage,
} from './highlighted-guide-utils';

describe('highlighted-guide-utils', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('getHighlightedGuideMarkerKey', () => {
    it('embeds hostname and guideId so changing either yields a fresh key', () => {
      expect(getHighlightedGuideMarkerKey('h.com', 'g1')).toBe(
        'grafana-pathfinder-highlighted-guide-auto-open-h.com:g1'
      );
      expect(getHighlightedGuideMarkerKey('h.com', 'g2')).not.toBe(getHighlightedGuideMarkerKey('h.com', 'g1'));
      expect(getHighlightedGuideMarkerKey('other.com', 'g1')).not.toBe(getHighlightedGuideMarkerKey('h.com', 'g1'));
    });
  });

  describe('marker round-trip', () => {
    it('returns false when no marker is written', () => {
      expect(hasHighlightedGuideAutoOpened('h.com', 'g1')).toBe(false);
    });

    it('round-trips write and read', () => {
      markHighlightedGuideAutoOpened('h.com', 'g1');
      expect(hasHighlightedGuideAutoOpened('h.com', 'g1')).toBe(true);
    });

    it('treats a different guideId as a separate marker (so flag changes re-arm)', () => {
      markHighlightedGuideAutoOpened('h.com', 'g1');
      expect(hasHighlightedGuideAutoOpened('h.com', 'g2')).toBe(false);
    });

    it('treats a different hostname as a separate marker (no cross-stack leakage)', () => {
      markHighlightedGuideAutoOpened('h.com', 'g1');
      expect(hasHighlightedGuideAutoOpened('other.com', 'g1')).toBe(false);
    });

    it('treats an empty guideId as never-auto-opened (no-op)', () => {
      markHighlightedGuideAutoOpened('h.com', '');
      expect(hasHighlightedGuideAutoOpened('h.com', '')).toBe(false);
      expect(localStorage.length).toBe(0);
    });
  });

  describe('clearHighlightedGuideMarkers', () => {
    it('removes only markers with the prefix, leaves other keys alone', () => {
      markHighlightedGuideAutoOpened('h.com', 'g1');
      markHighlightedGuideAutoOpened('h.com', 'g2');
      localStorage.setItem('unrelated-key', 'keep-me');
      clearHighlightedGuideMarkers('h.com');
      expect(hasHighlightedGuideAutoOpened('h.com', 'g1')).toBe(false);
      expect(hasHighlightedGuideAutoOpened('h.com', 'g2')).toBe(false);
      expect(localStorage.getItem('unrelated-key')).toBe('keep-me');
    });

    it('does not clear markers for a different hostname', () => {
      markHighlightedGuideAutoOpened('h.com', 'g1');
      markHighlightedGuideAutoOpened('other.com', 'g1');
      clearHighlightedGuideMarkers('h.com');
      expect(hasHighlightedGuideAutoOpened('h.com', 'g1')).toBe(false);
      expect(hasHighlightedGuideAutoOpened('other.com', 'g1')).toBe(true);
    });
  });

  describe('matchesHighlightedGuidePage', () => {
    it('returns false on empty pages (safe default)', () => {
      expect(matchesHighlightedGuidePage([], '/anywhere')).toBe(false);
    });

    it('matches wildcard prefix patterns', () => {
      expect(matchesHighlightedGuidePage(['/connections/datasources*'], '/connections/datasources/new')).toBe(true);
    });

    it('matches exact patterns with trailing-slash normalization', () => {
      expect(matchesHighlightedGuidePage(['/explore'], '/explore/')).toBe(true);
    });

    it('returns false when none of the patterns match', () => {
      expect(matchesHighlightedGuidePage(['/explore', '/dashboards*'], '/alerting')).toBe(false);
    });

    it('tolerates non-array input (defensive guard)', () => {
      expect(matchesHighlightedGuidePage(undefined as unknown as string[], '/explore')).toBe(false);
    });
  });

  describe('buildSyntheticFeaturedRecommendation', () => {
    it('returns null for blank input', () => {
      expect(buildSyntheticFeaturedRecommendation('')).toBeNull();
      expect(buildSyntheticFeaturedRecommendation('   ')).toBeNull();
    });

    it('builds a Recommendation for a known bundled id', () => {
      const rec = buildSyntheticFeaturedRecommendation('bundled:my-guide');
      expect(rec).toEqual({
        title: 'my-guide',
        url: 'bundled:my-guide',
        type: 'docs-page',
        matchAccuracy: 1,
        summary: '',
      });
    });

    it('maps api: shorthand to the backend-guide: URL form', () => {
      const rec = buildSyntheticFeaturedRecommendation('api:foo');
      expect(rec).toEqual({
        title: 'foo',
        url: 'backend-guide:foo',
        type: 'docs-page',
        matchAccuracy: 1,
        summary: '',
      });
    });

    it('returns null for unresolvable input (URL not on the allowlist)', () => {
      expect(buildSyntheticFeaturedRecommendation('https://malicious.example/x')).toBeNull();
    });

    it('returns null for an unknown bundled id', () => {
      expect(buildSyntheticFeaturedRecommendation('bundled:unknown')).toBeNull();
    });

    it('honors docTypeOverride when provided, overriding findDocPage auto-detection', () => {
      // mock returns 'docs-page' for bundled — override forces 'learning-journey'
      const rec = buildSyntheticFeaturedRecommendation('bundled:my-guide', 'learning-journey');
      expect(rec?.type).toBe('learning-journey');
    });

    it('falls back to findDocPage type when docTypeOverride is omitted', () => {
      const rec = buildSyntheticFeaturedRecommendation('bundled:my-guide');
      expect(rec?.type).toBe('docs-page');
    });
  });
});
