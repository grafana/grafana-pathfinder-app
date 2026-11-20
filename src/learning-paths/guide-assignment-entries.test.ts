import { selectGuideAssignmentEntries } from './guide-assignment-entries';
import type { AssignmentEntry } from '../lib/assignments-client';
import type { CatalogPackage } from '../types/package-catalog.types';

const assignment: AssignmentEntry = {
  targetType: 'guide',
  targetId: 'same',
  targetSource: 'app-platform',
  ruleId: 'one',
  satisfied: false,
  lifecycle: 'active',
  guides: [{ guideId: 'same', guideSource: 'app-platform', completed: false }],
};
const publicGuide: CatalogPackage = {
  key: 'bundled:same',
  id: 'same',
  title: 'Public',
  source: 'grafana',
  format: 'guide',
  url: 'bundled:same/content.json',
};
const privateGuide: CatalogPackage = {
  key: 'app-platform:same',
  id: 'same',
  title: 'Private',
  source: 'organization',
  format: 'guide',
  url: 'backend-guide:same',
};

it('does not launch a public guide for an unavailable private assignment', () => {
  const [entry] = selectGuideAssignmentEntries([assignment], [publicGuide]);
  expect(entry?.assignedGuide).toBeUndefined();
  expect(entry?.isGuideAssignment).toBe(true);
});
it('preserves distinct assignment rules and resolves the exact source', () => {
  const entries = selectGuideAssignmentEntries(
    [assignment, { ...assignment, ruleId: 'two' }],
    [publicGuide, privateGuide]
  );
  expect(entries).toHaveLength(2);
  expect(entries[0]?.assignedGuide).toBe(privateGuide);
  expect(entries[0]?.key).not.toBe(entries[1]?.key);
  expect(entries[0]?.path.title).toBe('Private');
});
it('uses backend completion evidence and marks absent evidence unknown', () => {
  const [complete, unknown] = selectGuideAssignmentEntries(
    [
      { ...assignment, satisfied: true, guides: [{ guideId: 'same', guideSource: 'app-platform', completed: true }] },
      { ...assignment, guides: undefined },
    ],
    [privateGuide]
  );
  expect(complete?.percent).toBe(100);
  expect(unknown?.assignment?.progressUnavailable).toBe(true);
});

it.each(['online-cdn', 'interactive-tutorials'])('resolves a migrated tutorial assigned from %s', (targetSource) => {
  const guide = { ...publicGuide, id: 'first-dashboard', key: 'bundled:first-dashboard' };
  const [entry] = selectGuideAssignmentEntries([{ ...assignment, targetId: guide.id, targetSource }], [guide]);
  expect(entry?.assignedGuide).toBe(guide);
});

it('resolves the online catalogue alias without matching a private guide', () => {
  const guide = { ...publicGuide, key: 'online-cdn:same' };
  const [entry] = selectGuideAssignmentEntries(
    [{ ...assignment, targetSource: 'interactive-tutorials' }],
    [privateGuide, guide]
  );
  expect(entry?.assignedGuide).toBe(guide);
});

it('uses source-qualified local progress only to offer a reset, not to satisfy an assignment', () => {
  const progress = new Map([
    [publicGuide.key, { percent: 100 }],
    [privateGuide.key, { percent: 0 }],
  ]);
  const [unstarted] = selectGuideAssignmentEntries([assignment], [publicGuide, privateGuide], progress);
  expect(unstarted?.guides[0]?.completed).toBe(false);
  progress.set(privateGuide.key, { percent: 100 });
  const [needsReset] = selectGuideAssignmentEntries([assignment], [publicGuide, privateGuide], progress);
  expect(needsReset?.guides[0]).toMatchObject({ completed: true, url: privateGuide.url });
  expect(needsReset?.percent).toBe(0);
  expect(needsReset?.assignment?.satisfied).toBe(false);
});
