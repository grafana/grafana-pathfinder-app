/**
 * Tripwire — the banner's documented surface coverage must match where it is mounted.
 *
 * This exists because that exact drift shipped once: FEATURE_FLAGS.md claimed the
 * experiment covered sidebar, floating, and full-screen while the banner was mounted
 * only on the context page, which nothing but the sidebar renders. Nothing failed —
 * the arm was simply invisible to anyone who never opened the recommendations list,
 * and the enrollment call that was supposed to cover the other two surfaces served
 * surfaces that never rendered it.
 *
 * A mount point and its enrollment seam are two halves of one thing: reading the flag
 * emits the exposure, so a surface that renders the banner without enrolling shows it
 * to users counted as excluded, and a surface that enrolls without rendering counts
 * users who could never have seen it. Both halves are pinned here.
 *
 * Source assertions rather than a mount: these surfaces need `@grafana/scenes` and a
 * theme provider that the Jest environment does not supply. Same reasoning, and same
 * shape, as components/full-screen/panel-mode-surface-toggles.contract.test.ts.
 */

import * as fs from 'fs';
import * as path from 'path';

const SRC_ROOT = path.resolve(__dirname, '..', '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, rel), 'utf-8');
}

// Every render path that mounts the banner, with the placement it passes.
const MOUNT_POINTS: Array<{ file: string; placement: string; surfaces: string }> = [
  {
    file: 'components/docs-panel/context-panel.tsx',
    placement: 'context-page',
    surfaces: 'sidebar (the recommendations list)',
  },
  {
    file: 'components/docs-panel/components/DocsPanelContentArea.tsx',
    placement: 'guide',
    surfaces: 'sidebar (above opened guide content)',
  },
  {
    file: 'components/floating-panel/FloatingPanelContent.tsx',
    placement: 'guide',
    surfaces: 'floating and full-screen (both render this component)',
  },
];

// Every surface whose mount effect enrolls. Mirrors ALLOWED_CALLERS in
// utils/experiments/enrollment-boundary.test.ts, which pins the same set from the
// other direction (nothing *else* may enroll).
const ENROLLMENT_SEAMS = [
  'module.tsx',
  'components/floating-panel/FloatingPanelManager.tsx',
  'components/full-screen/FullScreenPanel.tsx',
];

describe('interactive-learning banner surface coverage', () => {
  describe.each(MOUNT_POINTS)('$file', ({ file, placement, surfaces }) => {
    it(`mounts the banner for ${surfaces}`, () => {
      expect(read(file)).toContain('<InteractiveLearningBanner');
    });

    it(`passes the ${placement} placement`, () => {
      const src = read(file);
      // 'context-page' is the default, so that call site passes nothing.
      const expected = placement === 'context-page' ? '<InteractiveLearningBanner />' : `placement="${placement}"`;
      expect(src).toContain(expected);
    });
  });

  it.each(ENROLLMENT_SEAMS)('%s enrolls, so its rendered banner is never invisible', (file) => {
    expect(read(file)).toContain('enrollInteractiveLearningBannerExperiment()');
  });

  it('has an enrollment seam for every surface that mounts it', () => {
    // The pairing that actually matters, spelled out so the failure explains itself:
    // FloatingPanelContent is rendered by both managers, and each owns its own seam.
    const surfaceSeams = [
      { surface: 'sidebar', seam: 'module.tsx' },
      { surface: 'floating', seam: 'components/floating-panel/FloatingPanelManager.tsx' },
      { surface: 'fullscreen', seam: 'components/full-screen/FullScreenPanel.tsx' },
    ];

    const unenrolled = surfaceSeams
      .filter(({ seam }) => !read(seam).includes('enrollInteractiveLearningBannerExperiment()'))
      .map(({ surface }) => surface);

    if (unenrolled.length > 0) {
      throw new Error(
        `These surfaces render the banner but never enroll: ${unenrolled.join(', ')}.\n\n` +
          `Reading the flag is what emits the exposure, so a surface that renders the ` +
          `banner without enrolling shows the treatment to users the readout counts as ` +
          `excluded. Add the call to that surface's mount effect and to ALLOWED_CALLERS ` +
          `in utils/experiments/enrollment-boundary.test.ts.`
      );
    }
  });
});
