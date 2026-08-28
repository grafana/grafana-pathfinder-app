/** @jest-environment node */

import { readFileSync } from 'fs';
import { join } from 'path';

const FIXTURE_ROOT = join(__dirname, '../fixtures/shared-session-path');
const MARKER = 'https://shared-session.invalid/exact-browser-marker';
const STARTING_LOCATION = '/plugins/grafana-pathfinder-app?page=configuration';
interface FixtureManifest {
  startingLocation: string;
}

interface FixtureGuide {
  blocks: Array<Record<string, unknown>>;
}

type FixtureRepository = Record<string, { startingLocation?: string }>;

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, relativePath), 'utf-8')) as T;
}

it('uses an exact unsaved marker that no starting URL can restore', () => {
  const rootManifest = readJson<FixtureManifest>('manifest.json');
  const repository = readJson<FixtureRepository>('repository.json');
  const firstGuide = readJson<FixtureGuide>('enter-unsaved-config/content.json');
  const secondGuide = readJson<FixtureGuide>('use-unsaved-config/content.json');
  const firstBlock = firstGuide.blocks[0]!;
  const secondBlock = secondGuide.blocks[0]!;

  expect(rootManifest.startingLocation).toBe(STARTING_LOCATION);
  expect(repository['shared-session-enter-unsaved-config'].startingLocation).toBe(STARTING_LOCATION);
  expect(repository['shared-session-use-unsaved-config'].startingLocation).toBeUndefined();
  expect(STARTING_LOCATION).not.toContain(MARKER);

  expect(firstBlock).toMatchObject({
    action: 'formfill',
    targetvalue: MARKER,
    validateInput: true,
  });
  expect(secondBlock).toMatchObject({
    action: 'highlight',
    doIt: false,
  });
  expect(secondBlock.reftarget).toContain(`[value="${MARKER}"]`);
});
