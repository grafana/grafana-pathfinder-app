/**
 * Backend route registration ratchet.
 *
 * A tenant route is registered in three places: the custom routes in `kinds/manifest.cue`, the
 * `VersionedCustomRoutes` map in `pkg/provider/provider.go`, and the browser allowlist `backendPaths` in
 * `src/lib/backend-routes.ts`. They are edited by hand in different languages, so a route missing from one of them
 * fails only at runtime (a 404 from the host, or `Unknown backend route` in the browser). This test makes the
 * three agree. The procedure is recipe steps 1 and 2 in docs/design/BACKEND_PROXY_PATTERN.md#how-to-add-or-change-a-route.
 */

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PATTERN_DOC = 'docs/design/BACKEND_PROXY_PATTERN.md#how-to-add-or-change-a-route';
const METHODS = ['GET', 'POST', 'PUT', 'DELETE'];

function read(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function manifestRoutes(source: string): string[] {
  return [...source.matchAll(/"\/backend\/([^"]+)":\s*"(GET|POST|PUT|DELETE)"/g)].map(
    (match) => `${match[2] ?? ''} ${match[1] ?? ''}`
  );
}

function providerRoutes(source: string): string[] {
  return [
    ...source.matchAll(
      /Path:\s*"\/backend\/([^"]+)",\s*Method:\s*simple\.AppCustomRouteMethod(Get|Post|Put|Delete)\b/g
    ),
  ].map((match) => `${(match[2] ?? '').toUpperCase()} ${match[1] ?? ''}`);
}

function browserPaths(source: string): string[] {
  const block = source.match(/const backendPaths = \[([\s\S]*?)\] as const/)?.[1];
  if (block === undefined) {
    return [];
  }
  return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1] ?? '');
}

function difference(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((item) => !rightSet.has(item));
}

function routeRegistrationProblems(manifest: string[], provider: string[], browser: string[]): string[] {
  const problems: string[] = [];
  const manifestPaths = [...new Set(manifest.map((route) => route.split(' ').slice(1).join(' ')))];
  const duplicates = (routes: string[]) => routes.filter((route, index) => routes.indexOf(route) !== index);
  for (const [label, routes] of [
    ['kinds/manifest.cue', manifest],
    ['pkg/provider/provider.go', provider],
  ] as const) {
    for (const route of duplicates(routes)) {
      problems.push(`${label} registers "${route}" more than once.`);
    }
  }
  for (const route of difference(manifest, provider)) {
    problems.push(`"${route}" is in kinds/manifest.cue but not in VersionedCustomRoutes in pkg/provider/provider.go.`);
  }
  for (const route of difference(provider, manifest)) {
    problems.push(`"${route}" is in VersionedCustomRoutes in pkg/provider/provider.go but not in kinds/manifest.cue.`);
  }
  for (const route of difference(manifestPaths, browser)) {
    problems.push(
      `"${route}" is registered by the backend but missing from backendPaths in src/lib/backend-routes.ts.`
    );
  }
  for (const route of difference(browser, manifestPaths)) {
    problems.push(
      `"${route}" is in backendPaths in src/lib/backend-routes.ts but no backend route is registered for it.`
    );
  }
  return problems;
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
  it('declares the same routes in the manifest, the provider, and the browser allowlist', () => {
    const manifest = manifestRoutes(read('kinds/manifest.cue'));
    const provider = providerRoutes(read('pkg/provider/provider.go'));
    const browser = browserPaths(read('src/lib/backend-routes.ts'));

    expect(manifest.length).toBeGreaterThan(0);
    expect(provider.length).toBeGreaterThan(0);
    expect(browser.length).toBeGreaterThan(0);
    expect(manifest.every((route) => METHODS.some((method) => route.startsWith(`${method} `)))).toBe(true);

    const problems = routeRegistrationProblems(manifest, provider, browser);
    if (problems.length > 0) {
      throw new Error(failureMessage(problems));
    }
  });

  it('reports a route that is missing from any of the three places', () => {
    const manifest = ['GET a', 'POST b'];
    const provider = ['GET a', 'POST b'];
    const browser = ['a', 'b'];
    expect(routeRegistrationProblems(manifest, provider, browser)).toEqual([]);

    expect(routeRegistrationProblems([...manifest, 'GET c'], provider, browser).join('\n')).toMatch(
      /"GET c" is in kinds\/manifest\.cue but not in VersionedCustomRoutes/
    );
    expect(routeRegistrationProblems(manifest, [...provider, 'GET c'], browser).join('\n')).toMatch(
      /"GET c" is in VersionedCustomRoutes .* but not in kinds\/manifest\.cue/
    );
    expect(routeRegistrationProblems([...manifest, 'GET c'], [...provider, 'GET c'], browser).join('\n')).toMatch(
      /"c" is registered by the backend but missing from backendPaths/
    );
    expect(routeRegistrationProblems(manifest, provider, [...browser, 'c']).join('\n')).toMatch(
      /"c" is in backendPaths .* no backend route is registered/
    );
    expect(routeRegistrationProblems(manifest, ['GET a', 'PUT b'], browser).join('\n')).toMatch(/"POST b" is in kinds/);
  });

  it('parses the manifest, provider, and allowlist formats it relies on', () => {
    expect(manifestRoutes(' "/backend/x/my": "GET": {name: "y"}\n routes: namespaced: "/backend/z": "PUT": {')).toEqual(
      ['GET x/my', 'PUT z']
    );
    expect(
      providerRoutes(
        'simple.AppVersionRoute{Namespaced: true, Path: "/backend/x", Method: simple.AppCustomRouteMethodPost}: h,'
      )
    ).toEqual(['POST x']);
    expect(browserPaths("const backendPaths = [\n  'a',\n  'b/c',\n] as const;")).toEqual(['a', 'b/c']);
  });
});
