// force timezone to UTC to allow tests to work regardless of local timezone
// generally used by snapshots, but can affect specific tests
process.env.TZ = 'UTC';

const baseConfig = require('./.config/jest.config');
const { grafanaESModules, nodeModulesToTransform } = require('./.config/jest/utils');

module.exports = {
  // Jest configuration provided by Grafana scaffolding
  ...baseConfig,

  // @grafana/coda-client, and @react-hookz/web with its own @ver0/deep-equal
  // dependency (both reached through @grafana/data), ship ESM-only with no CJS
  // build, so they need the same treatment as the packages the scaffolding
  // already knows about.
  // .config/README.md#esm-errors-with-jest
  transformIgnorePatterns: [
    nodeModulesToTransform([...grafanaESModules, '@grafana/coda-client', '@react-hookz/web', '@ver0/deep-equal']),
  ],

  // Polyfill jsdom-only globals before the scaffolded setup runs so test
  // files can opt into `@jest-environment node` without breaking the
  // scaffolded setup's HTMLCanvasElement / matchMedia references.
  setupFilesAfterEnv: ['<rootDir>/.config/jest-env-polyfill.js', ...(baseConfig.setupFilesAfterEnv ?? [])],

  // Asset imports are rendered as test stubs.
  moduleNameMapper: {
    ...require('./.config/jest.config').moduleNameMapper,
    '\\.(png|jpe?g|webp)$': '<rootDir>/__mocks__/imageMock.js',
    '\\.(svg)$': '<rootDir>/__mocks__/svgMock.js', // Mock SVG files
    // The real entry eagerly loads runtime internals that suites' partial
    // @grafana/data mocks break; plugin-compat treats an empty module as a host
    // without the unstable APIs and falls through to the @grafana/runtime ones.
    '^@grafana/runtime/unstable$': '<rootDir>/__mocks__/grafanaRuntimeUnstable.js',
  },

  // Extend testMatch to include tests/e2e-runner/utils unit tests
  testMatch: [
    ...require('./.config/jest.config').testMatch,
    '<rootDir>/tests/e2e-runner/utils/**/*.test.{js,jsx,ts,tsx}',
  ],

  // Coverage configuration
  // Default off: `npm run test:ci` (and focused subsets via `--`) skip coverage
  // entirely, so agents and developers don't get false-failures from threshold
  // checks on partial test runs. The full pre-merge gate (`npm run check`) calls
  // `npm run test:coverage`, which passes `--coverage` on the CLI and overrides
  // this default — that's where the threshold enforcement lives.
  collectCoverage: false,
  coverageReporters: ['text', 'html', 'lcov'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.{spec,test,stories}.{ts,tsx}',
    '!src/**/types.ts',
    '!src/**/index.ts',
    '!src/**/*.d.ts',
  ],
  coverageThreshold: {
    global: {
      statements: 1,
      branches: 1,
      functions: 1,
      lines: 1,
    },
  },
};
