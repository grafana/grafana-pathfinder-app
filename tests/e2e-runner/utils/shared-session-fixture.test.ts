/** @jest-environment node */

import { readFileSync } from 'fs';
import { join } from 'path';

import { parsePageGuide } from './guide-runner/run-guide';

const FIXTURE_ROOT = join(__dirname, '../fixtures/shared-session-path');
const MARKER = 'https://shared-session.invalid/exact-browser-marker';
const STARTING_LOCATION = '/plugins/grafana-pathfinder-app?page=configuration';
interface FixtureManifest {
  startingLocation: string;
}

interface FixtureGuide {
  id: string;
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
  const secondGuideContent = readFileSync(join(FIXTURE_ROOT, 'use-unsaved-config/content.json'), 'utf-8');
  const plannedSecondGuideId = 'shared-session-use-unsaved-config';
  const firstBlock = firstGuide.blocks[0]!;
  const secondBlock = secondGuide.blocks[0]!;

  expect(rootManifest.startingLocation).toBe(STARTING_LOCATION);
  expect(repository['shared-session-enter-unsaved-config'].startingLocation).toBe(STARTING_LOCATION);
  expect(repository[plannedSecondGuideId].startingLocation).toBeUndefined();
  expect(secondGuide.id).not.toBe(plannedSecondGuideId);
  expect(parsePageGuide('use-unsaved-config/content.json', secondGuideContent, plannedSecondGuideId).id).toBe(
    plannedSecondGuideId
  );
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
