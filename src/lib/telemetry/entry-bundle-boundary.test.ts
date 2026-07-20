import * as fs from 'fs';
import * as path from 'path';

// Entry-eager modules must import telemetry submodules directly (bridge/surface),
// never the ./telemetry barrel — a barrel import here pulls the whole package
// (including the Faro SDK) into module.js. See lib/telemetry/bridge.ts.
const ENTRY_EAGER_FILES = ['lib/analytics.ts', 'lib/logging.ts', 'global-state/panel-mode.ts', 'module.tsx'];

const BARREL_IMPORT_RE = /(?:from\s+['"]|require\(['"])[^'"]*\/telemetry['"]/;

describe('telemetry entry-bundle import discipline', () => {
  it.each(ENTRY_EAGER_FILES)('%s does not import the telemetry barrel', (relativePath) => {
    const source = fs.readFileSync(path.join(__dirname, '../../', relativePath), 'utf8');
    expect(source).not.toMatch(BARREL_IMPORT_RE);
  });
});
