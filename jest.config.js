// force timezone to UTC to allow tests to work regardless of local timezone
// generally used by snapshots, but can affect specific tests
process.env.TZ = 'UTC';

const baseConfig = require('./.config/jest.config');

module.exports = {
  // Jest configuration provided by Grafana scaffolding
  ...baseConfig,

  // Polyfill jsdom-only globals before the scaffolded setup runs so test
  // files can opt into `@jest-environment node` without breaking the
  // scaffolded setup's HTMLCanvasElement / matchMedia references.
  setupFilesAfterEnv: ['<rootDir>/.config/jest-env-polyfill.js', ...(baseConfig.setupFilesAfterEnv ?? [])],

  // Add SVG file handling to base config
  moduleNameMapper: {
    ...require('./.config/jest.config').moduleNameMapper,
    '\\.(svg)$': '<rootDir>/__mocks__/svgMock.js', // Mock SVG files
  },

  // Extend testMatch to include tests/e2e-runner/utils unit tests
  testMatch: [
    ...require('./.config/jest.config').testMatch,
    '<rootDir>/tests/e2e-runner/utils/**/*.test.{js,jsx,ts,tsx}',
  ],

  // Coverage configuration
  collectCoverage: true,
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
