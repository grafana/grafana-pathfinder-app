import * as fs from 'fs';
import * as path from 'path';

// Entry-eager modules must import telemetry submodules directly (bridge/surface),
// never the ./telemetry barrel — a barrel import here pulls the whole package
// (including the Faro SDK) into module.js. See lib/telemetry/bridge.ts.
const ENTRY_EAGER_FILES = ['lib/analytics.ts', 'lib/logging.ts', 'global-state/panel-mode.ts', 'module.tsx'];

const BARREL_IMPORT_RE = /(?:from\s+['"]|require\(['"])[^'"]*\/telemetry['"]/;

// The same rule for the hooks barrel: it re-exports useGuideProgressState, whose
// chain reaches lib/user-storage and zod. Importing it from module.tsx roughly
// doubled module.js (113 KB -> 224 KB raw) before this was pinned.
const HOOKS_BARREL_IMPORT_RE = /(?:from\s+['"]|require\(['"])\.{1,2}(?:\/\.\.)*\/hooks['"]/;

describe('telemetry entry-bundle import discipline', () => {
  it.each(ENTRY_EAGER_FILES)('%s does not import the telemetry barrel', (relativePath) => {
    const source = fs.readFileSync(path.join(__dirname, '../../', relativePath), 'utf8');
    expect(source).not.toMatch(BARREL_IMPORT_RE);
  });
});

describe('hooks entry-bundle import discipline', () => {
  it('module.tsx does not import the hooks barrel', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../module.tsx'), 'utf8');
    expect(source).not.toMatch(HOOKS_BARREL_IMPORT_RE);
  });
});
