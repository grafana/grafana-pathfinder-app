/**
 * Tests for the is-terminal-active requirement checker.
 */

import { checkRequirements } from './requirements-checker.utils';

// Mock the TerminalContext module-level getter
let mockTerminalStatus = 'disconnected';
jest.mock('../integrations/coda/TerminalContext', () => ({
  getTerminalConnectionStatus: () => mockTerminalStatus,
}));

// Mock dom-utils
jest.mock('../lib/dom', () => {
  const actual = jest.requireActual('../lib/dom');
  return {
    ...actual,
    reftargetExistsCheck: jest.fn().mockResolvedValue({ requirement: 'exists-reftarget', pass: true }),
    navmenuOpenCheck: jest.fn().mockResolvedValue({ requirement: 'navmenu-open', pass: true }),
  };
});

// Mock Grafana runtime
jest.mock('@grafana/runtime', () => ({
  locationService: { getLocation: jest.fn() },
  config: {
    bootData: { user: null },
    buildInfo: { version: '10.0.0', env: 'production' },
    featureToggles: {},
  },
  hasPermission: jest.fn(),
  getDataSourceSrv: jest.fn(),
  getBackendSrv: jest.fn(),
}));

// Mock ContextService
jest.mock('../context-engine', () => ({
  ContextService: {
    fetchPlugins: jest.fn(),
    fetchDashboardsByName: jest.fn(),
    fetchDataSources: jest.fn(),
  },
}));

describe('is-terminal-active requirement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTerminalStatus = 'disconnected';
  });

  it('fails when terminal is disconnected', async () => {
    mockTerminalStatus = 'disconnected';

    const result = await checkRequirements({
      requirements: 'is-terminal-active',
      maxRetries: 0,
    });

    expect(result.pass).toBe(false);
    expect(result.error).toHaveLength(1);
    expect(result.error?.[0]?.requirement).toBe('is-terminal-active');
    expect(result.error?.[0]?.pass).toBe(false);
  });

  it('passes when terminal is connected', async () => {
    mockTerminalStatus = 'connected';

    const result = await checkRequirements({
      requirements: 'is-terminal-active',
      maxRetries: 0,
    });

    expect(result.pass).toBe(true);
  });

  it('fails when terminal is in error state', async () => {
    mockTerminalStatus = 'error';

    const result = await checkRequirements({
      requirements: 'is-terminal-active',
      maxRetries: 0,
    });

    expect(result.pass).toBe(false);
  });

  it('fails when terminal is connecting', async () => {
    mockTerminalStatus = 'connecting';

    const result = await checkRequirements({
      requirements: 'is-terminal-active',
      maxRetries: 0,
    });

    expect(result.pass).toBe(false);
  });
});
