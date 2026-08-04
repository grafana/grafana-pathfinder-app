/**
 * Mount-wiring tripwire for singleton-era editor recovery.
 *
 * Recovery is intentionally independent of conditional tab restoration:
 * pending/live guide tabs skip restore, but must never skip rebinding orphaned
 * legacy editor storage to a reachable editor tab.
 */
import * as fs from 'fs';
import * as path from 'path';

function read(rel: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', '..', rel), 'utf-8');
}

describe('legacy editor recovery mount wiring', () => {
  it('runs from the sidebar mount path even when restoration is skipped', () => {
    const src = read('components/docs-panel/hooks/useTabRestoration.ts');
    expect(src).toContain('model.restoreTabsAsync().then(() => model.recoverLegacyEditorTab())');
    expect(src).toMatch(/else \{\s*model\.recoverLegacyEditorTab\(\)/);
  });

  it.each(['components/floating-panel/FloatingPanelManager.tsx', 'components/full-screen/FullScreenPanel.tsx'])(
    'runs after the optional restore attempt in %s',
    (file) => {
      const src = read(file);
      const restore = src.indexOf('const restore = ');
      const recover = src.indexOf('panel.recoverLegacyEditorTab()', restore);
      expect(restore).toBeGreaterThanOrEqual(0);
      expect(recover).toBeGreaterThan(restore);
    }
  );
});
