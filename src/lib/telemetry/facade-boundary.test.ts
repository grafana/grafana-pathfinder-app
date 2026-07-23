import * as fs from 'fs';
import * as path from 'path';

// pushFaroEvent/pushFaroMeasurement are the schema-bearing primitives: the name
// a call site passes becomes the collector's event namespace directly. Product
// code goes through the typed facade ops (./facade.ts) so every name lives in
// the TELEMETRY_EVENTS/TELEMETRY_MEASUREMENTS registry (./types.ts) — one
// reviewable file for the analytics-and-telemetry concern. Span helpers, error
// pushes, and view setters are fine to use directly; see
// docs/developer/TELEMETRY.md.
const RESTRICTED_IMPORT_RE = /import\s+(?:type\s+)?\{[^}]*\b(?:pushFaroEvent|pushFaroMeasurement)\b/;

const SRC_ROOT = path.join(__dirname, '../..');
const ALLOWED_DIR = path.join(SRC_ROOT, 'lib/telemetry');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return walk(full);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe('telemetry facade boundary', () => {
  it('no production module outside lib/telemetry imports the raw event/measurement primitives', () => {
    const violations = walk(SRC_ROOT)
      .filter((file) => !file.startsWith(ALLOWED_DIR))
      .filter((file) => !/\.test\.(ts|tsx)$/.test(file))
      .filter((file) => RESTRICTED_IMPORT_RE.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC_ROOT, file));
    expect(violations).toEqual([]);
  });
});
