import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkspaceLink } from './WorkspaceLink';
import { codaWorkspaceUrl, getCapabilities } from './coda-api';

jest.mock('./coda-api', () => ({ ...jest.requireActual('./coda-api'), getCapabilities: jest.fn() }));
const capabilities = jest.mocked(getCapabilities);
beforeEach(() => {
  jest.clearAllMocks();
});

it('opens the exact connected VM in an isolated new tab', async () => {
  capabilities.mockResolvedValue({ features: ['workspace-files', 'explicit-vm-attachment'] } as Awaited<
    ReturnType<typeof getCapabilities>
  >);
  const open = jest.spyOn(window, 'open').mockReturnValue(null);
  render(<WorkspaceLink connected vmId="guide-vm" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open in Coda editor' }));
  expect(open).toHaveBeenCalledWith('/a/grafana-coda-app/workspace?vmId=guide-vm', '_blank', 'noopener,noreferrer');
  open.mockRestore();
});

it('is disabled when the guide is disconnected', async () => {
  capabilities.mockResolvedValue({ features: ['workspace-files', 'explicit-vm-attachment'] } as Awaited<
    ReturnType<typeof getCapabilities>
  >);
  render(<WorkspaceLink connected={false} vmId="stale-vm" />);
  expect(await screen.findByRole('button', { name: 'Open in Coda editor' })).toBeDisabled();
});

it('hides the action on older backends', async () => {
  capabilities.mockResolvedValue({
    registered: true,
    features: [],
    templates: [],
    sampleApps: [],
    alloyScenarios: [],
    limits: { maxVMsPerUser: 1, maxExecTimeoutMs: 15000, maxOutputBytes: 1048576 },
  });
  render(<WorkspaceLink connected vmId="guide-vm" />);
  await waitFor(() => expect(capabilities).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: 'Open in Coda editor' })).not.toBeInTheDocument();
});

it('encodes file hints without changing the navigation origin', () => {
  const url = new URL(codaWorkspaceUrl('vm/?x', '/etc/a?b#c.alloy', 12), 'https://grafana.example');
  expect(url.origin).toBe('https://grafana.example');
  expect(url.searchParams.get('vmId')).toBe('vm/?x');
  expect(url.searchParams.get('path')).toBe('/etc/a?b#c.alloy');
  expect(url.searchParams.get('line')).toBe('12');
});
