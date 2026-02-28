/**
 * Package Loader Tests (Layer 2)
 *
 * Tests content loading from bundled sources. Uses the actual bundled
 * content for happy-path tests and verifies error handling for missing
 * or invalid content.
 */

import { loadBundledContent, loadBundledManifest, loadBundledLegacyGuide } from './loader';

// ============ loadBundledContent ============

describe('loadBundledContent', () => {
  it('should load content.json from a real bundled package', () => {
    const result = loadBundledContent('welcome-to-grafana/');

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.data.id).toBe('welcome-to-grafana');
    expect(result.data.title).toBeDefined();
    expect(result.data.blocks).toBeDefined();
    expect(Array.isArray(result.data.blocks)).toBe(true);
  });

  it('should handle path without trailing slash', () => {
    const result = loadBundledContent('welcome-to-grafana');

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.data.id).toBe('welcome-to-grafana');
  });

  it('should return not-found for nonexistent path', () => {
    const result = loadBundledContent('nonexistent-package/');

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('not-found');
    expect(result.error.message).toContain('nonexistent-package');
  });

  it('should load content from multiple known bundled packages', () => {
    const packages = ['first-dashboard', 'prometheus-grafana-101', 'welcome-to-grafana-cloud'];

    for (const pkg of packages) {
      const result = loadBundledContent(pkg);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.id).toBe(pkg);
        expect(result.data.blocks.length).toBeGreaterThan(0);
      }
    }
  });
});

// ============ loadBundledManifest ============

describe('loadBundledManifest', () => {
  it('should load manifest.json from a real bundled package', () => {
    const result = loadBundledManifest('welcome-to-grafana/');

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.data.id).toBe('welcome-to-grafana');
    expect(result.data.type).toBe('guide');
  });

  it('should handle path without trailing slash', () => {
    const result = loadBundledManifest('welcome-to-grafana');

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.data.id).toBe('welcome-to-grafana');
  });

  it('should return not-found for nonexistent path', () => {
    const result = loadBundledManifest('nonexistent-package/');

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('not-found');
  });

  it('should parse manifest with dependency fields', () => {
    const result = loadBundledManifest('loki-grafana-101/');

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.data.depends).toBeDefined();
    expect(result.data.provides).toBeDefined();
  });

  it('should parse manifest with targeting metadata', () => {
    const result = loadBundledManifest('welcome-to-grafana-cloud/');

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.data.targeting).toBeDefined();
    expect(result.data.targeting?.match).toBeDefined();
  });

  it('should tolerate extension metadata (passthrough)', () => {
    const result = loadBundledManifest('welcome-to-grafana/');

    expect(result.ok).toBe(true);
  });
});

// ============ loadBundledLegacyGuide ============

describe('loadBundledLegacyGuide', () => {
  it('should return not-found for a nonexistent file', () => {
    const result = loadBundledLegacyGuide('nonexistent.json');

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('not-found');
  });

  it('should load a content.json file as a legacy guide', () => {
    const result = loadBundledLegacyGuide('welcome-to-grafana/content.json');

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.data.id).toBe('welcome-to-grafana');
    expect(result.data.blocks).toBeDefined();
  });
});

// ============ Content/manifest consistency ============

describe('content-manifest consistency', () => {
  const BUNDLED_PACKAGES = [
    'welcome-to-grafana',
    'welcome-to-grafana-cloud',
    'first-dashboard',
    'first-dashboard-cloud',
    'prometheus-grafana-101',
    'loki-grafana-101',
    'prometheus-advanced-queries',
    'block-editor-tutorial',
    'json-guide-demo',
    'e2e-framework-test',
  ];

  it.each(BUNDLED_PACKAGES)('content and manifest should both load for %s', (pkg) => {
    const content = loadBundledContent(pkg);
    const manifest = loadBundledManifest(pkg);

    expect(content.ok).toBe(true);
    expect(manifest.ok).toBe(true);

    if (content.ok && manifest.ok) {
      expect(content.data.id).toBe(manifest.data.id);
    }
  });
});
