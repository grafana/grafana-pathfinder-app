import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { SandboxRecovery } from './SandboxRecovery';
import { deleteVM, listVMs } from './coda-api';

jest.mock('./coda-api', () => ({ deleteVM: jest.fn(), listVMs: jest.fn() }));

const vm = {
  id: 'broken-vm',
  template: 'vm-aws-k8s',
  state: 'active',
  owner: 'me',
  createdAt: '',
  expiresAt: '',
  config: { app: 'demo', scenario: 'alloy/logs' },
};
const remove = jest.mocked(deleteVM);
const list = jest.mocked(listVMs);

beforeEach(() => {
  jest.clearAllMocks();
  list.mockResolvedValue([vm]);
  remove.mockResolvedValue(undefined);
});

it('requires confirmation, then deletes exactly the failed VM and preserves its intent', async () => {
  const onReplace = jest.fn();
  render(<SandboxRecovery vmId="broken-vm" onReplace={onReplace} />);
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Replace sandbox' }));
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Delete and replace' }));
  await waitFor(() =>
    expect(onReplace).toHaveBeenCalledWith({
      template: 'vm-aws-k8s',
      app: 'demo',
      scenario: 'alloy/logs',
    })
  );
  expect(remove).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledWith('broken-vm');
});

it('does not create a replacement when deletion is refused', async () => {
  remove.mockRejectedValue(new Error('Another terminal still holds this VM'));
  const onReplace = jest.fn();
  render(<SandboxRecovery vmId="broken-vm" onReplace={onReplace} />);
  fireEvent.click(screen.getByRole('button', { name: 'Replace sandbox' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete and replace' }));
  expect(await screen.findByText('Another terminal still holds this VM')).toBeInTheDocument();
  expect(onReplace).not.toHaveBeenCalled();
});

it('does not delete a different VM when the failed VM has disappeared', async () => {
  list.mockResolvedValue([{ ...vm, id: 'other-vm' }]);
  const onReplace = jest.fn();
  render(<SandboxRecovery vmId="broken-vm" onReplace={onReplace} />);
  fireEvent.click(screen.getByRole('button', { name: 'Replace sandbox' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete and replace' }));
  expect(await screen.findByText(/This sandbox is no longer available/)).toBeInTheDocument();
  expect(remove).not.toHaveBeenCalled();
  expect(onReplace).not.toHaveBeenCalled();
});

it('does not start a replacement if the recovery prompt unmounts during deletion', async () => {
  let finish!: () => void;
  remove.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const onReplace = jest.fn();
  const view = render(<SandboxRecovery vmId="broken-vm" onReplace={onReplace} />);
  fireEvent.click(screen.getByRole('button', { name: 'Replace sandbox' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete and replace' }));
  await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
  view.unmount();
  await act(async () => finish());
  expect(onReplace).not.toHaveBeenCalled();
});
