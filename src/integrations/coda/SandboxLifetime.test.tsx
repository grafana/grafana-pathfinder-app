import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { lifetimeClient, type LifetimeVM as VM } from './coda-api';
import { SandboxLifetime } from './SandboxLifetime';

const expiry = new Date(Date.now() + 5 * 60000).toISOString();
const vm = {
  id: 'vm-test',
  expiresAt: expiry,
  lifetime: {
    extensionMinutes: 30,
    extensionsUsed: 0,
    extensionsRemaining: 3,
    eligibleAt: new Date(Date.now() - 5 * 60000).toISOString(),
    maxExpiresAt: new Date(Date.now() + 95 * 60000).toISOString(),
    canExtend: true,
    unavailableReason: null,
  },
} as VM;
const client = () => ({ getVM: jest.fn().mockResolvedValue(vm), extendVM: jest.fn() });
beforeEach(() => {
  Object.defineProperty(global.crypto, 'randomUUID', { configurable: true, value: () => 'request-unique-123456' });
});
it('reuses the original key and expiry after a lost response, even if polling sees the new grant', async () => {
  const api = client();
  const extended = {
    ...vm,
    expiresAt: new Date(Date.parse(expiry) + 30 * 60000).toISOString(),
    lifetime: {
      ...vm.lifetime!,
      extensionsUsed: 1,
      extensionsRemaining: 2,
      canExtend: false,
      unavailableReason: 'too_early' as const,
      eligibleAt: new Date(Date.now() + 25 * 60000).toISOString(),
    },
  };
  api.extendVM.mockRejectedValueOnce(new Error('Connection interrupted')).mockResolvedValueOnce(extended);
  render(<SandboxLifetime client={api as unknown as typeof lifetimeClient} vmId="vm-test" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Extend by 30 minutes' }));
  api.getVM.mockResolvedValue(extended);
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Retry extension' }));
  await waitFor(() => expect(api.extendVM).toHaveBeenCalledTimes(2));
  expect(api.extendVM.mock.calls[0]).toEqual(['vm-test', 'request-unique-123456', expiry]);
  expect(api.extendVM.mock.calls[1]).toEqual(api.extendVM.mock.calls[0]);
  await waitFor(() => expect(screen.queryByRole('button')).not.toBeInTheDocument());
});
it('hides the control after all three extensions', async () => {
  const api = client();
  api.getVM.mockResolvedValue({
    ...vm,
    lifetime: {
      ...vm.lifetime,
      extensionsRemaining: 0,
      extensionsUsed: 3,
      canExtend: false,
      unavailableReason: 'limit_reached',
    },
  });
  render(<SandboxLifetime client={api as unknown as typeof lifetimeClient} vmId="vm-test" />);
  await waitFor(() => expect(api.getVM).toHaveBeenCalled());
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('hides extension controls when the upstream has no lifetime contract', async () => {
  const api = client();
  api.getVM.mockResolvedValue({ ...vm, lifetime: undefined });
  const { container } = render(<SandboxLifetime client={api as unknown as typeof lifetimeClient} vmId="vm-test" />);
  await waitFor(() => expect(api.getVM).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

it('shows only a compact action when the final ten minutes begin', async () => {
  jest.useFakeTimers();
  try {
    const api = client();
    api.getVM.mockResolvedValue({
      ...vm,
      expiresAt: new Date(Date.now() + 10 * 60000 + 1000).toISOString(),
      lifetime: {
        ...vm.lifetime,
        canExtend: false,
        unavailableReason: 'too_early',
        eligibleAt: new Date(Date.now() + 1000).toISOString(),
      },
    });
    const { container } = render(<SandboxLifetime client={api as unknown as typeof lifetimeClient} vmId="vm-test" />);
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
    await act(async () => jest.advanceTimersByTime(1000));
    expect(screen.getByRole('button', { name: 'Extend by 30 minutes' })).toHaveTextContent('+30 min');
    expect(container).not.toHaveTextContent('extensions remaining');
    expect(container).not.toHaveTextContent('Grafana credentials');
  } finally {
    jest.useRealTimers();
  }
});
