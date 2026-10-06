const { checkBundleBudget } = require('../../scripts/check-bundle-budget') as {
  checkBundleBudget: (stats: unknown) => number;
};

const stats = (...sizes: number[]) => ({
  entrypoints: {
    module: { assets: sizes.map((size, index) => ({ name: `${index}.js`, size })) },
  },
});

it('allows an entry below the budget and rejects the exact limit', () => {
  expect(checkBundleBudget(stats(99_999))).toBe(99_999);
  expect(() => checkBundleBudget(stats(100_000))).toThrow('must be below');
});

it('counts every initial chunk instead of only module.js', () => {
  expect(() => checkBundleBudget(stats(60_000, 40_000))).toThrow('100000 bytes');
});

it('counts shared initial assets once and excludes asynchronous assets and source maps', () => {
  const shared = { name: 'shared.js?_cache=hash', size: 30_000 };
  expect(
    checkBundleBudget({
      entrypoints: {
        module: { assets: [shared, { name: 'module.js', size: 20_000 }, { name: 'module.js.map', size: 200_000 }] },
        other: { assets: [shared, { name: 'other.js', size: 10_000 }] },
      },
      assets: [{ name: 'lazy.js', size: 200_000 }],
    })
  ).toBe(60_000);
});

it.each([{}, { entrypoints: {} }, stats(), { ...stats(1), errors: ['build failed'] }, stats(NaN)])(
  'fails closed for invalid build statistics: %j',
  (input) => expect(() => checkBundleBudget(input)).toThrow()
);
