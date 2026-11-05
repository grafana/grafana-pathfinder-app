import {
  canIntroduceOrganizationGuide,
  organizationGuideBudgetKey,
  readOrganizationGuideBudget,
  writeOrganizationGuideBudget,
  ORGANIZATION_GUIDE_COOLDOWN_MS,
} from './organization-guide-budget';

beforeEach(() => localStorage.clear());

it('scopes the budget by instance, user, and stable guide identity without delimiter collisions', () => {
  const key = organizationGuideBudgetKey('stack', '1', 'guide');
  expect(
    new Set([
      key,
      organizationGuideBudgetKey('other', '1', 'guide'),
      organizationGuideBudgetKey('stack', '2', 'guide'),
      organizationGuideBudgetKey('stack', '1', 'other'),
    ]).size
  ).toBe(4);
  expect(organizationGuideBudgetKey('a:b', 'c', 'd')).not.toBe(organizationGuideBudgetKey('a', 'b:c', 'd'));
});

it('allows exactly three openings with a 24-hour cooldown, including the exact boundary', () => {
  const budget = { count: 0, lastOpenedAt: 0, completed: false };
  expect(canIntroduceOrganizationGuide(budget, 1)).toBe(true);
  for (const count of [1, 2]) {
    expect(
      canIntroduceOrganizationGuide({ ...budget, count, lastOpenedAt: 100 }, 100 + ORGANIZATION_GUIDE_COOLDOWN_MS - 1)
    ).toBe(false);
    expect(
      canIntroduceOrganizationGuide({ ...budget, count, lastOpenedAt: 100 }, 100 + ORGANIZATION_GUIDE_COOLDOWN_MS)
    ).toBe(true);
    expect(canIntroduceOrganizationGuide({ ...budget, count, lastOpenedAt: 100 }, 99)).toBe(false);
  }
  expect(canIntroduceOrganizationGuide({ ...budget, count: 3 }, Number.MAX_SAFE_INTEGER)).toBe(false);
  expect(canIntroduceOrganizationGuide({ ...budget, completed: true }, Number.MAX_SAFE_INTEGER)).toBe(false);
});

it.each([
  'broken',
  '{}',
  'null',
  '{"count":-1,"lastOpenedAt":0,"completed":false}',
  '{"count":4,"lastOpenedAt":0,"completed":false}',
])('fails closed on corrupt budget %s', (raw) => {
  localStorage.setItem('budget', raw);
  expect(readOrganizationGuideBudget(localStorage, 'budget')).toBeNull();
});

it('requires successful readback before storage is considered writable', () => {
  const budget = { count: 1, lastOpenedAt: 123, completed: false };
  expect(writeOrganizationGuideBudget(localStorage, 'budget', budget)).toBe(true);
  expect(readOrganizationGuideBudget(localStorage, 'budget')).toEqual(budget);
  const storage = { getItem: () => null, setItem: () => {} } as unknown as Storage;
  expect(writeOrganizationGuideBudget(storage, 'budget', budget)).toBe(false);
  const broken = {
    getItem: () => {
      throw new Error();
    },
    setItem: () => {
      throw new Error();
    },
  } as unknown as Storage;
  expect(readOrganizationGuideBudget(broken, 'budget')).toBeNull();
  expect(writeOrganizationGuideBudget(broken, 'budget', budget)).toBe(false);
});
