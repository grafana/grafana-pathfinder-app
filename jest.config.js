// force timezone to UTC to allow tests to work regardless of local timezone
// generally used by snapshots, but can affect specific tests
process.env.TZ = 'UTC';

module.exports = {
  // Jest configuration provided by Grafana scaffolding
  ...require('./.config/jest.config'),

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
