// force timezone to UTC to allow tests to work regardless of local timezone
// generally used by snapshots, but can affect specific tests
process.env.TZ = 'UTC';

module.exports = {
  // Jest configuration provided by Grafana scaffolding
  ...require('./.config/jest.config'),
  
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
      statements: 80,
      branches: 80,
      functions: 80,
      lines: 80,
    },
  },
};
