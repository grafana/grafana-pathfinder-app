/**
 * Exit codes per design spec
 */
export const ExitCode = {
  SUCCESS: 0,
  TEST_FAILURE: 1,
  CONFIGURATION_ERROR: 2,
  GRAFANA_UNREACHABLE: 3,
  AUTH_FAILURE: 4,
} as const;
