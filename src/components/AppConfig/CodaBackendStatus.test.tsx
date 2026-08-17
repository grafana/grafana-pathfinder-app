/**
 * This page used to read `registered` alone, which stays true of a refresh
 * token that expired 90 days ago while every session 401s — so it rendered a
 * green "Coda is ready" on a stack that could not provision a single VM.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { CodaBackendStatus } from './CodaBackendStatus';
import { getCapabilities, type CodaCapabilities } from '../../integrations/coda/coda-api';
import { isCodaPluginAvailable, isCodaProbeSupported } from '../../integrations/coda/useCodaAvailability.hook';

jest.mock('../../integrations/coda/coda-api', () => ({
  ...jest.requireActual('../../integrations/coda/coda-api'),
  getCapabilities: jest.fn(),
}));

jest.mock('../../integrations/coda/useCodaAvailability.hook', () => ({
  isCodaPluginAvailable: jest.fn(),
  isCodaProbeSupported: jest.fn(),
}));

const mockedGetCapabilities = getCapabilities as jest.MockedFunction<typeof getCapabilities>;
const mockedIsCodaPluginAvailable = isCodaPluginAvailable as jest.MockedFunction<typeof isCodaPluginAvailable>;
const mockedIsCodaProbeSupported = isCodaProbeSupported as jest.MockedFunction<typeof isCodaProbeSupported>;

function capabilities(overrides: Partial<CodaCapabilities> = {}): CodaCapabilities {
  return {
    registered: true,
    templates: [{ id: 'vm-aws', name: 'Generic sandbox', description: '' }],
    sampleApps: [],
    alloyScenarios: [],
    limits: { maxVMsPerUser: 3, maxExecTimeoutMs: 120_000, maxOutputBytes: 32_768 },
    ...overrides,
  };
}

/** `TextLink` renders a router `Link` for an internal href. */
function renderStatus() {
  return render(
    <MemoryRouter>
      <CodaBackendStatus enabled />
    </MemoryRouter>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedIsCodaPluginAvailable.mockResolvedValue(true);
  mockedIsCodaProbeSupported.mockReturnValue(true);
});

describe('CodaBackendStatus', () => {
  it('blames the Grafana version, not the plugin, when the probe cannot run', async () => {
    mockedIsCodaProbeSupported.mockReturnValue(false);
    mockedIsCodaPluginAvailable.mockResolvedValue(false);

    renderStatus();

    await waitFor(() => expect(screen.getByText(/too old for the terminal/i)).toBeInTheDocument());
    expect(screen.queryByText(/plugin not found/i)).not.toBeInTheDocument();
    expect(mockedIsCodaPluginAvailable).not.toHaveBeenCalled();
  });

  it('does not call a registered backend ready when its credential has expired', async () => {
    mockedGetCapabilities.mockResolvedValue(
      capabilities({ credential: { state: 'expired', checkedAt: '2026-08-01T10:00:00Z' } })
    );

    renderStatus();

    await waitFor(() => expect(screen.getByText(/credential has expired/i)).toBeInTheDocument());
    expect(screen.queryByText(/coda is ready/i)).not.toBeInTheDocument();
  });

  it('names the configuration problems that stop registration', async () => {
    mockedGetCapabilities.mockResolvedValue(capabilities({ configErrors: ['apiUrl is not set'] }));

    renderStatus();

    await waitFor(() => expect(screen.getByText('apiUrl is not set')).toBeInTheDocument());
    expect(screen.queryByText(/coda is ready/i)).not.toBeInTheDocument();
  });

  it('names them on an unregistered backend too, since that is why it is unregistered', async () => {
    mockedGetCapabilities.mockResolvedValue(
      capabilities({ registered: false, configErrors: ['enrollmentKey is not set'] })
    );

    renderStatus();

    await waitFor(() => expect(screen.getByText(/coda is not registered/i)).toBeInTheDocument());
    expect(screen.getByText('enrollmentKey is not set')).toBeInTheDocument();
  });

  // Absent fields mean an older Coda plugin, and `unknown` / `unreachable` are
  // absent evidence rather than a dead credential. Neither may make this page
  // stricter than reading `registered` was.
  it.each([
    ['a backend that reports neither field', capabilities()],
    ['a credential nothing has exercised yet', capabilities({ credential: { state: 'unknown' } })],
    ['a Coda that was unreachable at the last check', capabilities({ credential: { state: 'unreachable' } })],
    ['an empty configErrors array', capabilities({ configErrors: [] })],
  ])('still reports ready for %s', async (_name, caps) => {
    mockedGetCapabilities.mockResolvedValue(caps);

    renderStatus();

    await waitFor(() => expect(screen.getByText(/coda is ready/i)).toBeInTheDocument());
  });
});
