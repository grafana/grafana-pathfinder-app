import {
  bundledTutorialContentKey,
  bundledTutorialCompletionSource,
  legacyOnlineTutorialId,
} from './bundled-tutorial-identity';
import { resolveCompletionIdentity } from '../completion-records/completion-identity';
import { journeyCompletionStorage, interactiveStepStorage } from './user-storage';
import { migrateBundledTutorialProgress } from './storage/progress-keys';
import { StorageKeys, buildVersionedSectionStorageKey } from './storage-keys';

const id = 'first-dashboard';
const local = `bundled:${id}`;
const online = `https://interactive-learning.grafana.net/packages/${id}/content.json`;

beforeEach(() => localStorage.clear());

it('shares only allowlisted bundled and official package URLs', () => {
  expect(bundledTutorialContentKey(online)).toBe(local);
  expect(bundledTutorialContentKey(`${local}/content.json`)).toBe(local);
  for (const unrelated of [
    online.replace('/packages/', '/guides/'),
    online.replace('.net/', '.net.evil/'),
    'bundled:first-dashboard-rss',
  ]) {
    expect(bundledTutorialContentKey(unrelated)).toBe(unrelated);
  }
  expect(bundledTutorialCompletionSource('app-platform', id)).toBe('app-platform');
});

it('preserves the bundled durable identity when loading online', () => {
  expect(
    resolveCompletionIdentity({ repository: 'interactive-tutorials', packageManifest: { id }, fallbackId: id })
  ).toEqual({ guideSource: 'bundled', guideId: id });
});

it('shares partial progress and resets across sources without importing old RSS progress', async () => {
  localStorage.setItem(
    StorageKeys.JOURNEY_COMPLETION,
    JSON.stringify({ [online]: 100, [`${local}/content.json`]: 35 })
  );
  expect(await journeyCompletionStorage.get(online)).toBe(35);
  await journeyCompletionStorage.set(online, 60);
  expect(await journeyCompletionStorage.get(local)).toBe(60);
  await journeyCompletionStorage.clear(online);
  expect(await journeyCompletionStorage.get(local)).toBe(0);
  expect(JSON.parse(localStorage.getItem(StorageKeys.JOURNEY_COMPLETION)!)[online]).toBe(100);
});

it('migrates legacy bundled step keys, shares new steps and clears both sources', async () => {
  const legacy = buildVersionedSectionStorageKey(
    StorageKeys.INTERACTIVE_STEPS_PREFIX,
    `${local}/content.json`,
    'intro'
  );
  localStorage.setItem(legacy, JSON.stringify(['step-1']));
  migrateBundledTutorialProgress();
  expect(await interactiveStepStorage.getCompleted(online, 'intro')).toEqual(new Set(['step-1']));
  expect(localStorage.getItem(legacy)).toBeNull();
  await interactiveStepStorage.setCompleted(online, 'intro', new Set(['step-1', 'step-2']));
  expect(await interactiveStepStorage.getCompleted(local, 'intro')).toEqual(new Set(['step-1', 'step-2']));
  await interactiveStepStorage.clearAllForContent(online);
  expect(await interactiveStepStorage.getCompleted(local, 'intro')).toEqual(new Set());
});

it('keeps historical online identity in the shared catalog', () => {
  expect(legacyOnlineTutorialId('first-dashboard')).toBe('first-dashboard-rss');
  expect(legacyOnlineTutorialId('welcome-to-grafana')).toBeUndefined();
});
