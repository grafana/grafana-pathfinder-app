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
  // The sidebar-mount seam: "first sidebar open".
  'module.tsx',
  // The banner itself, covering the floating and full-screen surfaces where the
  // sidebar mount effect never runs.
  'components/InteractiveLearningBanner/InteractiveLearningBanner.tsx',
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

describe('interactive-learning banner enrollment boundary', () => {
  const referencing = walk(SRC_ROOT)
    .filter((abs) => fs.readFileSync(abs, 'utf8').includes(ENROLL_FN))
    .map((abs) => path.relative(SRC_ROOT, abs).split(path.sep).join('/'))
    .sort();

  it('is referenced only from its definition, its barrel, and the two panel-open seams', () => {
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
