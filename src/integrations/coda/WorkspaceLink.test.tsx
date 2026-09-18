import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { config } from '@grafana/runtime';
import { WorkspaceLink } from './WorkspaceLink';
import { codaWorkspaceUrl, type CodaCapabilities } from './coda-api';
import { loadCodaCapabilities } from './useCodaAvailability.hook';
import { testIds } from '../../constants/testIds';

jest.mock('./useCodaAvailability.hook', () => ({ loadCodaCapabilities: jest.fn() }));
const capabilities = jest.mocked(loadCodaCapabilities);
const usable: CodaCapabilities = {
  registered: true,
  features: ['workspace-files', 'explicit-vm-attachment'],
  templates: [],
  sampleApps: [],
  alloyScenarios: [],
  limits: { maxVMsPerUser: 1, maxExecTimeoutMs: 15000, maxOutputBytes: 1048576 },
};
const originalSubUrl = config.appSubUrl;
beforeEach(() => {
  jest.clearAllMocks();
  config.appSubUrl = '';
  capabilities.mockResolvedValue(usable);
});
afterEach(() => {
  jest.restoreAllMocks();
  config.appSubUrl = originalSubUrl;
});

it('opens the exact connected VM in an isolated new tab', async () => {
  const open = jest.spyOn(window, 'open').mockReturnValue(null);
  render(<WorkspaceLink connected vmId="guide-vm" />);
  fireEvent.click(await screen.findByRole('button', { name: 'IDE' }));
  expect(screen.getByTestId(testIds.codaTerminal.openIdeButton)).toHaveTextContent('IDE');
  expect(open).toHaveBeenCalledWith('/a/grafana-coda-app/ide?vmId=guide-vm', '_blank', 'noopener,noreferrer');
});

it.each([
  { connected: false, vmId: null },
  { connected: true, vmId: null },
])('does not navigate with connected=$connected and vmId=$vmId', async (props) => {
  const open = jest.spyOn(window, 'open').mockReturnValue(null);
  render(<WorkspaceLink {...props} />);
  const button = await screen.findByRole('button', { name: 'IDE' });
  expect(button).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(button);
  expect(open).not.toHaveBeenCalled();
});

it.each([
  ['no capabilities', null],
  ['older backend', { ...usable, features: [] }],
  ['file access only', { ...usable, features: ['workspace-files'] }],
  ['VM attachment only', { ...usable, features: ['explicit-vm-attachment'] }],
  ['unregistered backend', { ...usable, registered: false }],
  ['expired credentials', { ...usable, credential: { state: 'expired' } }],
  ['configuration error', { ...usable, configErrors: ['api_url_missing'] }],
] as Array<[string, CodaCapabilities | null]>)('hides the action for %s', async (_label, caps) => {
  capabilities.mockResolvedValue(caps);
  await act(async () => {
    render(<WorkspaceLink connected vmId="guide-vm" />);
  });
  expect(capabilities).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'IDE' })).not.toBeInTheDocument();
});

it('hides the action when capability discovery rejects', async () => {
  capabilities.mockRejectedValue(new Error('404'));
  await act(async () => {
    render(<WorkspaceLink connected vmId="guide-vm" />);
  });
  expect(screen.queryByRole('button', { name: 'IDE' })).not.toBeInTheDocument();
});

it('ignores capability results after unmount', async () => {
  let resolve!: (caps: CodaCapabilities) => void;
  capabilities.mockReturnValue(new Promise((done) => (resolve = done)));
  const { unmount } = render(<WorkspaceLink connected vmId="guide-vm" />);
  unmount();
  await act(async () => resolve(usable));
  expect(screen.queryByRole('button', { name: 'IDE' })).not.toBeInTheDocument();
});

it('encodes file hints without changing the navigation origin', () => {
  const url = new URL(codaWorkspaceUrl('vm/?x', '/etc/a?b#c.alloy', 12), 'https://grafana.example');
  expect(url.origin).toBe('https://grafana.example');
  expect(url.searchParams.get('vmId')).toBe('vm/?x');
  expect(url.searchParams.get('path')).toBe('/etc/a?b#c.alloy');
  expect(url.searchParams.get('line')).toBe('12');
});

it('opens IDE under the configured Grafana sub-path', async () => {
  config.appSubUrl = '/grafana';
  const open = jest.spyOn(window, 'open').mockReturnValue(null);
  render(<WorkspaceLink connected vmId="guide-vm" />);
  fireEvent.click(await screen.findByRole('button', { name: 'IDE' }));
  expect(open).toHaveBeenCalledWith('/grafana/a/grafana-coda-app/ide?vmId=guide-vm', '_blank', 'noopener,noreferrer');
});

it('uses the current VM after a session changes', async () => {
  const open = jest.spyOn(window, 'open').mockReturnValue(null);
  const { rerender } = render(<WorkspaceLink connected vmId="old-vm" />);
  await screen.findByRole('button', { name: 'IDE' });
  rerender(<WorkspaceLink connected vmId="current-vm" />);
  fireEvent.click(screen.getByRole('button', { name: 'IDE' }));
  expect(open).toHaveBeenCalledWith('/a/grafana-coda-app/ide?vmId=current-vm', '_blank', 'noopener,noreferrer');
});
