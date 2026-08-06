/**
 * Phase 0 tripwire (Pattern J — contract-surface preservation)
 *
 * Pins the `pathfinder-auto-open-docs` CustomEvent contract that docs-panel owns:
 *   1. A listener for the event is registered somewhere in the docs-panel tree.
 *   2. The handler routes to `model.openLearningJourney` for journey URLs and
 *      `model.openDocsPage` otherwise — the source-side dispatch contract.
 *   3. The untrusted `event.detail.source` is coerced via `coerceLaunchSource`
 *      at the boundary (preserves the typed LaunchSource contract).
 *
 * Why source-assertion (not runtime mount):
 *   `@grafana/scenes` + `@grafana/ui` require a theme provider that is not
 *   available in the Jest environment — see `docs-panel.contract.test.tsx`
 *   for prior art and rationale. Tracked-file substring assertions are the
 *   established tripwire shape for the docs-panel surface.
 *
 * Refactor maintenance:
 *   When the listener moves to a hook (Phase 2 — `useAutoOpenListener`),
 *   add that hook's path to TRACKED_FILES. The exhaustiveness assertions
 *   keep working without modification.
 *
 * @see High-Risk Refactor Guidelines — Pattern J: Contract-Surface Extraction
 *      https://github.com/grafana/grafana-pathfinder-app/wiki/High-Risk-Refactor-Guidelines
 */

import * as fs from 'fs';
import * as path from 'path';

const PANEL_ROOT = path.join(__dirname);

/**
 * Files allowed to own the listener side of the `pathfinder-auto-open-docs`
 * contract. The tripwire passes if the required references appear in *any*
 * one of these files — extracting the listener to a new hook only requires
 * appending the new path here.
 */
const TRACKED_FILES = ['docs-panel.tsx', 'hooks/useAutoOpenListener.ts'];

const REQUIRED_REFERENCES = {
  listenerRegistration: 'addEventListener(AUTO_OPEN_DOCS_EVENT',
  listenerCleanup: 'removeEventListener(AUTO_OPEN_DOCS_EVENT',
  routeLearningJourney: 'openLearningJourney(',
  routeDocsPage: 'openDocsPage(',
  sourceCoercion: 'coerceLaunchSource(',
  journeyUrlMatcher: 'isLearningJourneyUrl(',
};

function loadTrackedSources(): Array<{ file: string; src: string | null }> {
  return TRACKED_FILES.map((file) => {
    const fullPath = path.join(PANEL_ROOT, file);
    return {
      file,
      src: fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf-8') : null,
    };
  });
}

describe('Phase 0 tripwire: pathfinder-auto-open-docs CustomEvent contract', () => {
  it('the event name constant still carries the wire-contract string', () => {
    // Dispatchers and the listener share AUTO_OPEN_DOCS_EVENT; the string
    // itself is the cross-surface contract (external guides may dispatch it),
    // so renaming the VALUE is a breaking change even if every import compiles.
    const eventNames = fs.readFileSync(path.join(PANEL_ROOT, '..', '..', 'lib', 'event-names.ts'), 'utf-8');
    expect(eventNames).toContain("AUTO_OPEN_DOCS_EVENT = 'pathfinder-auto-open-docs'");
  });

  it('the shared routing predicate still tests journey pathnames', () => {
    const urlValidation = fs.readFileSync(path.join(PANEL_ROOT, 'utils', 'url-validation.ts'), 'utf-8');
    expect(urlValidation).toContain('/learning-journeys/');
    expect(urlValidation).toContain('/learning-paths/');
  });

  it('listener registration exists in exactly one tracked file', () => {
    const matches = loadTrackedSources().filter(
      ({ src }) => src && src.includes(REQUIRED_REFERENCES.listenerRegistration)
    );
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches.length).toBeLessThanOrEqual(1);
  });

  it('listener cleanup pairs with registration in the same tracked file', () => {
    const owner = loadTrackedSources().find(({ src }) => src && src.includes(REQUIRED_REFERENCES.listenerRegistration));
    expect(owner?.src).toBeDefined();
    expect(owner!.src).toContain(REQUIRED_REFERENCES.listenerCleanup);
  });

  it('handler routes journey URLs through openLearningJourney and others through openDocsPage', () => {
    const owner = loadTrackedSources().find(({ src }) => src && src.includes(REQUIRED_REFERENCES.listenerRegistration));
    expect(owner?.src).toBeDefined();
    expect(owner!.src).toContain(REQUIRED_REFERENCES.routeLearningJourney);
    expect(owner!.src).toContain(REQUIRED_REFERENCES.routeDocsPage);
    expect(owner!.src).toContain(REQUIRED_REFERENCES.journeyUrlMatcher);
  });

  it('untrusted event.detail.source is coerced via coerceLaunchSource at the boundary', () => {
    const owner = loadTrackedSources().find(({ src }) => src && src.includes(REQUIRED_REFERENCES.listenerRegistration));
    expect(owner?.src).toBeDefined();
    expect(owner!.src).toContain(REQUIRED_REFERENCES.sourceCoercion);
  });
});

/**
 * #1450 — the auto-open listener must be mounted on EVERY surface that can own
 * the display, each mode-gated to its own surface. The listener lives in one
 * hook, but the fire-and-forget event is dropped unless the surface that owns
 * the display has actually called `useAutoOpenListener`. Nothing else pins that
 * these three exact call sites exist, so deleting one would leave the hook's own
 * focused tests green while silently recreating the pre-#1450 regression (a
 * docs-link click into the void). This tripwire fails the moment a surface stops
 * mounting the listener or mounts it with the wrong surface gate.
 */
const SURFACE_MOUNT_OWNERS = [
  { file: 'docs-panel.tsx', call: "useAutoOpenListener(model, 'sidebar')" },
  { file: '../floating-panel/FloatingPanelManager.tsx', call: "useAutoOpenListener(panel, 'floating')" },
  { file: '../full-screen/FullScreenPanel.tsx', call: "useAutoOpenListener(panel, 'fullscreen')" },
];

describe('Auto-open listener is mounted on all launch surfaces (#1450)', () => {
  it.each(SURFACE_MOUNT_OWNERS)('$file mounts useAutoOpenListener with its surface gate', ({ file, call }) => {
    const src = fs.readFileSync(path.join(PANEL_ROOT, file), 'utf-8');
    expect(src).toContain(call);
  });
});

/**
 * #1450 transition-order invariant. `isSidebarMounted` doubles as "a listener
 * is ready," so a surface must clear it on unmount ONLY when it still owns the
 * mode. During a sidebar → floating/fullscreen transition the incoming surface
 * (a separate React root) can set the flag true before the outgoing sidebar's
 * cleanup runs; an unconditional clear there clobbers readiness and strands
 * every later intercepted link. ContextSidebar is not runtime-mountable in Jest
 * (needs a scenes/ui theme provider — see the header note), so this pins the
 * mode-gated clear at the source, matching the tripwire style above.
 */
describe('Sidebar cleanup is mode-gated to avoid clobbering a successor surface (#1450)', () => {
  it('module.tsx clears the mounted flag only while the sidebar still owns the mode', () => {
    const moduleSrc = fs.readFileSync(path.join(PANEL_ROOT, '..', '..', 'module.tsx'), 'utf-8');
    expect(moduleSrc).toMatch(/getMode\(\)\s*===\s*'sidebar'\s*\)\s*\{\s*sidebarState\.setIsSidebarMounted\(false\)/);
  });
});
