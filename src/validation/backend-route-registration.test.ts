/**
 * Browser half of the backend route registration ratchet.
 *
 * `src/app-sdk-manifest.json` is the manifest `npm run generate:kinds` emits from `kinds/manifest.cue`, and it is the
 * contract the host serves. Every namespaced route it declares must be reachable through `backendRoute()`, and the
 * browser must not allow a path the backend does not serve. The provider half is
 * `TestProviderRegistersExactlyTheManifestRoutes` in `pkg/provider/route_identity_ratchet_test.go`.
 */

import manifest from '../app-sdk-manifest.json';
import { backendPaths, backendRoute } from '../lib/backend-routes';

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(),
  config: { namespace: 'stacks-1', featureToggles: {} },
}));

const PATTERN_DOC = 'docs/design/BACKEND_PROXY_PATTERN.md#how-to-add-or-change-a-route';
const BACKEND_PREFIX = '/backend/';

type BrowserPath = Parameters<typeof backendRoute>[0];

function manifestBackendPaths(): string[] {
  const version = manifest.spec.versions.find((candidate) => candidate.name === 'v1alpha1');
  return Object.keys(version?.routes.namespaced ?? {})
    .filter((route) => route.startsWith(BACKEND_PREFIX))
    .map((route) => route.slice(BACKEND_PREFIX.length));
}

function failureMessage(problems: string[]): string {
  return [
    'Backend route registrations are out of step:',
    ...problems.map((problem) => `  - ${problem}`),
    '',
    'A route must be declared in kinds/manifest.cue, registered in pkg/provider/provider.go, and allowed in',
    'src/lib/backend-routes.ts. Fix whichever side is missing, then run `npm run generate:kinds` if the manifest changed.',
    `Procedure: ${PATTERN_DOC}`,
  ].join('\n');
}

describe('Backend route registration', () => {
  it('lets the browser reach exactly the routes the generated manifest declares', () => {
    const declared = manifestBackendPaths();
    expect(declared.length).toBeGreaterThan(0);

    const problems: string[] = [];
    for (const route of declared) {
      try {
        expect(backendRoute(route as BrowserPath)).toBe(
          `/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/stacks-1/backend/${route}`
        );
      } catch {
        problems.push(
          `"${route}" is declared in the manifest but backendRoute() rejects it (src/lib/backend-routes.ts).`
        );
      }
    }
    for (const route of backendPaths) {
      if (!declared.includes(route)) {
        problems.push(
          `"${route}" is in backendPaths in src/lib/backend-routes.ts but the manifest declares no such route.`
        );
      }
    }
    if (problems.length > 0) {
      throw new Error(failureMessage(problems));
    }
  });
});
