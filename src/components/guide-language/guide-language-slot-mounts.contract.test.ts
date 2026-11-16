/**
 * The guide-language and translation-notice slots mount once per shared content
 * component: DocsPanelContentArea (sidebar) and FloatingPanelContent (floating and
 * full screen). Both mounts sit beside GuideVersionNotice, so a future slot
 * component never has to edit those files. The runtime mount tests live beside
 * each component; this pins the full-screen reuse.
 *
 * Source assertion rather than a mount for FullScreenPanel: it needs a scenes
 * theme provider the Jest environment lacks (see
 * components/full-screen/sidebar-handoff-wiring.contract.test.ts).
 */

import * as fs from 'fs';
import * as path from 'path';

function read(rel: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', '..', rel), 'utf-8');
}

describe('guide language slot mounts', () => {
  it('full screen renders its guide through FloatingPanelContent', () => {
    const fullScreenPanel = read('components/full-screen/FullScreenPanel.tsx');

    expect(fullScreenPanel).toMatch(
      /import \{ FloatingPanelContent \} from '\.\.\/floating-panel\/FloatingPanelContent';/
    );
    expect(fullScreenPanel).toMatch(/<FloatingPanelContent\b/);
  });

  it.each([
    ['sidebar', 'components/docs-panel/components/DocsPanelContentArea.tsx'],
    ['floating and full screen', 'components/floating-panel/FloatingPanelContent.tsx'],
  ])('the %s content component mounts both slots after the version notice', (_surface, file) => {
    const source = read(file);

    expect(source).toMatch(
      /<GuideVersionNotice\b[\s\S]*?\/>\s*<GuideLanguageSlot\b[^>]*\/>\s*<TranslationNoticeSlot\b/
    );
  });
});
