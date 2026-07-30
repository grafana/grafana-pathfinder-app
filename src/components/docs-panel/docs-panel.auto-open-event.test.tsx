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
