/**
 * Mount-wiring tripwire for singleton-era editor recovery.
 *
 * Sidebar recovery remains independent; floating/fullscreen recovery is part
 * of their ordered restore-before-handoff initialization.
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
    'uses ordered surface initialization in %s',
    (file) => {
      const src = read(file);
      expect(src).toContain('initializePanelTabsOnMount(panel,');
    }
  );

  it('recovers legacy storage after restoring and before applying a handoff', () => {
    const src = read('components/docs-panel/pendingGuideRouter.ts');
    const restore = src.indexOf('await panel.restoreTabsAsync()');
    const recover = src.indexOf('panel.recoverLegacyEditorTab()', restore);
    const handoff = src.indexOf('openPendingGuide(panel, pending', recover);
    expect(restore).toBeGreaterThanOrEqual(0);
    expect(recover).toBeGreaterThan(restore);
    expect(handoff).toBeGreaterThan(recover);
  });
});
