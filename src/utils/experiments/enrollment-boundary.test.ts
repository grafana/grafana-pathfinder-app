/**
 * Enrollment-timing boundary.
 *
 * `enrollInteractiveLearningBannerExperiment` emits the experiment's exposure
 * event the first time it runs, so its call sites define what "enrolled" means.
 * A stray call from boot code (module scope, a requirements check, a telemetry
 * path) would silently enroll users who never opened Pathfinder and quietly
 * invalidate the readout — nothing else in the suite would notice. This pins the
 * allowed call sites the way facade-boundary.test.ts pins the telemetry sinks.
 */

import * as fs from 'fs';
import * as path from 'path';

const SRC_ROOT = path.resolve(__dirname, '..', '..');
const ENROLL_FN = 'enrollInteractiveLearningBannerExperiment';

// Paths are relative to src/. Adding one is a deliberate decision about when a
// user counts as enrolled — not a formality.
const ALLOWED_CALLERS = new Set([
  // Defines it.
  'utils/experiments/interactive-learning-banner.ts',
  // Re-exports it.
  'utils/experiments/index.ts',
  // One seam per surface that can show the banner: "first Pathfinder panel open".
  // The sidebar carries both placements (context page and above guide content); the
  // other two have no context page, but do render the guide placement.
  'module.tsx',
  'components/floating-panel/FloatingPanelManager.tsx',
  'components/full-screen/FullScreenPanel.tsx',
  // The banner component deliberately is NOT here: it reads the memo through
  // subscribeToEnrollment, because enrolling from render would let a render React
  // replays or abandons burn the exposure on a banner nobody saw. Surface coverage is
  // pinned separately, by components/InteractiveLearningBanner/surface-coverage.test.ts.
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(abs, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(abs);
    }
  }
  return out;
}

const referencingFiles = (symbol: string) =>
  walk(SRC_ROOT)
    .filter((abs) => fs.readFileSync(abs, 'utf8').includes(symbol))
    .map((abs) => path.relative(SRC_ROOT, abs).split(path.sep).join('/'))
    .sort();

describe('interactive-learning banner enrollment boundary', () => {
  const referencing = referencingFiles(ENROLL_FN);

  it('is referenced only from its definition, its barrel, and the panel-mount seams', () => {
    const unexpected = referencing.filter((rel) => !ALLOWED_CALLERS.has(rel));

    if (unexpected.length > 0) {
      throw new Error(
        `${ENROLL_FN} is called from files that are not panel-open seams:\n` +
          unexpected.map((rel) => `  - src/${rel}`).join('\n') +
          `\n\nEvaluating this flag emits the exposure event, so every call site decides ` +
          `when a user counts as enrolled. Move the call to a seam that runs when a ` +
          `Pathfinder panel opens, read the memoised arm with ` +
          `getEnrolledInteractiveLearningBannerConfig() instead, or — if this really is a ` +
          `new panel-open seam — add it to ALLOWED_CALLERS in this file.`
      );
    }
  });

  it('every allowed caller still exists', () => {
    const stale = [...ALLOWED_CALLERS].filter((rel) => !referencing.includes(rel));
    expect(stale).toEqual([]);
  });
});

// The auto-open guide experiment enrolls inside startAutoOpenGuideExperiment, when a
// user reaches a configured page with Pathfinder closed. Anything else that reads its
// flag could activate it at the wrong moment, so both symbols are pinned.
describe('auto-open guide enrollment boundary', () => {
  const PINNED: Record<string, string[]> = {
    startAutoOpenGuideExperiment: ['module.tsx', 'utils/experiments/auto-open-guide/index.ts'],
    AUTO_OPEN_GUIDE_EXPERIMENT_FLAG: [
      'constants/auto-open-guide-experiment.ts',
      // Enrichment names the flag on cached arms; it never evaluates it.
      'utils/experiments/active-experiments.ts',
      'utils/experiments/auto-open-guide/index.ts',
    ],
  };

  it.each(Object.entries(PINNED))('%s is referenced only from its pinned files', (symbol, allowed) => {
    expect(referencingFiles(symbol)).toEqual([...allowed].sort());
  });
});
