import { createOutcomeEvidence, createOutcomeEvidenceStore } from './outcome-evidence';
import type { OutcomeScope } from '../../types/outcome.types';
import type { CheckResultError } from '../../types/requirements.types';
import type { UserStorage } from '../../types/storage.types';

const scope: OutcomeScope = { userId: 'user', orgId: 'org', guideId: 'guide', guideRevision: 'revision' };
const satisfied: CheckResultError = { requirement: 'resource', pass: true, verdict: 'satisfied' };
function memoryStorage(): UserStorage {
  const values = new Map<string, unknown>();
  return {
    async getItem<T>(key: string) {
      return (values.get(key) as T | undefined) ?? null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
    async removeItem(key) {
      values.delete(key);
    },
    async clear() {
      values.clear();
    },
  };
}

it.each<CheckResultError[]>([
  [],
  [{ requirement: 'manual', pass: true }],
  [{ requirement: 'skipped', pass: true }],
  [{ requirement: 'resource', pass: true, verdict: 'invalid' }],
  [{ requirement: 'resource', pass: false, verdict: 'unavailable' }],
  [satisfied, { requirement: 'other', pass: false, verdict: 'unsatisfied' }],
])('requires explicit successful evidence: %j', (...checks) => {
  expect(createOutcomeEvidence(scope, 'outcome', 'uid', checks, 123)).toBeNull();
});

it('restores evidence without converting progress and isolates user, org, guide, and revision', async () => {
  const storage = memoryStorage();
  await storage.setItem('pathfinder-interactive-completion', { guide: 100 });
  const store = createOutcomeEvidenceStore(storage, () => 123);
  expect(await store.read(scope)).toEqual([]);
  await store.record(scope, 'outcome', 'uid', [satisfied]);
  const restored = createOutcomeEvidenceStore(storage);
  expect(await restored.read(scope)).toMatchObject([{ resourceUid: 'uid', verifiedAt: 123 }]);
  for (const field of ['userId', 'orgId', 'guideId', 'guideRevision'] as const) {
    expect(await restored.read({ ...scope, [field]: 'other' })).toEqual([]);
  }
});

it('serializes concurrent writes and leaves historical evidence after an unsuccessful check', async () => {
  const store = createOutcomeEvidenceStore(memoryStorage(), () => 123);
  await Promise.all([store.record(scope, 'one', 'uid1', [satisfied]), store.record(scope, 'two', 'uid2', [satisfied])]);
  expect(await store.read(scope)).toHaveLength(2);
  expect(await store.record(scope, 'one', 'uid1', [{ ...satisfied, pass: false, verdict: 'unavailable' }])).toBeNull();
  expect(await store.read(scope)).toHaveLength(2);
});

it('bounds history and propagates storage failures without inventing evidence', async () => {
  const storage = memoryStorage();
  const store = createOutcomeEvidenceStore(storage, () => 123);
  for (let i = 0; i < 202; i++) {
    await store.record(scope, `outcome-${i}`, 'uid', [satisfied]);
  }
  expect(await store.read(scope)).toHaveLength(200);
  jest.spyOn(storage, 'setItem').mockRejectedValueOnce(new Error('Full'));
  await expect(store.record(scope, 'failed', 'uid', [satisfied])).rejects.toThrow('Full');
  expect((await store.read(scope)).some((record) => record.outcomeId === 'failed')).toBe(false);
});
