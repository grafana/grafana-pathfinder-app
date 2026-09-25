import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { KioskPage } from './KioskPage';
import { prepareKioskInputs } from './prepare-kiosk-inputs';
import { launchKioskGuide } from './launch-kiosk-guide';
import { logger } from '../../lib/logging';
import { KioskLaunchError } from '../../lib/kiosk-launch-error';
import { KioskFormError } from '../../lib/input-value';
import { reportAppInteraction } from '../../lib/analytics';
import type { KioskPage as Page } from '../../types/kiosk-page.schema';

jest.mock('../../lib/logging', () => ({ logger: { error: jest.fn(), warn: jest.fn() } }));

jest.mock('./prepare-kiosk-inputs', () => ({ prepareKioskInputs: jest.fn() }));
jest.mock('./launch-kiosk-guide', () => ({ launchKioskGuide: jest.fn() }));
jest.mock('./KioskTile', () => ({ KioskTile: () => null }));
jest.mock('../interactive-tutorial/datasource-options', () => ({
  filterDatasourcesByType: () => [],
  toDatasourceOptions: () => [{ label: 'Private data source', value: 'private-datasource' }],
}));
jest.mock('../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: { KioskInteraction: 'kiosk_interaction' },
}));

const page: Page = {
  version: 1,
  blocks: [
    {
      type: 'launch-form',
      ruleId: 'demo',
      label: 'Launch',
      inputs: [{ inputType: 'text', variableName: 'privateName', prompt: 'Website', required: true }],
    },
  ],
};
const rules = [{ id: 'demo', title: 'Private title', url: 'bundled:welcome', description: '', type: 'guide' as const }];
const prepare = jest.mocked(prepareKioskInputs);
const report = jest.mocked(reportAppInteraction);

beforeEach(() => jest.clearAllMocks());

it('counts input engagement once, then submission and readiness without authored or entered text', async () => {
  prepare.mockResolvedValue({} as Awaited<ReturnType<typeof prepareKioskInputs>>);
  render(<KioskPage page={page} rules={rules} mode="instance" onLaunch={jest.fn()} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://private.example' } });
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://other-private.example' } });
  fireEvent.click(screen.getByRole('button', { name: 'Launch' }));
  await waitFor(() => expect(launchKioskGuide).toHaveBeenCalled());
  expect(report.mock.calls).toEqual([
    [
      'kiosk_interaction',
      {
        launch_mode: 'instance',
        block_index: 0,
        component: 'input',
        action: 'change',
        input_type: 'text',
        input_index: 0,
      },
    ],
    ['kiosk_interaction', { launch_mode: 'instance', block_index: 0, component: 'launch-form', action: 'submit' }],
    ['kiosk_interaction', { launch_mode: 'instance', block_index: 0, component: 'launch-form', action: 'ready' }],
  ]);
});

it.each([
  [new KioskFormError('Enter a valid origin'), 'validation', 'Enter a valid origin'],
  [new KioskFormError('Could not save inputs. Try again', 'storage'), 'storage', 'Could not save inputs. Try again'],
  [new Error('Private authoring details'), 'unavailable', 'Could not open this guide. Please try again later.'],
])('classifies failure without emitting the exception', async (error, reason, message) => {
  prepare.mockRejectedValue(error);
  render(<KioskPage page={page} rules={rules} mode="instance" onLaunch={jest.fn()} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://private.example' } });
  fireEvent.click(screen.getByRole('button', { name: 'Launch' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(message as string);
  expect(report).toHaveBeenLastCalledWith('kiosk_interaction', {
    launch_mode: 'instance',
    block_index: 0,
    component: 'launch-form',
    action: 'error',
    reason,
  });
  expect(JSON.stringify(report.mock.calls)).not.toContain('private');
  expect(launchKioskGuide).not.toHaveBeenCalled();
});

it('reports copy success and failure without the command or clipboard exception', async () => {
  const writeText = jest
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('Private clipboard details'));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(
    <KioskPage
      page={{ version: 1, blocks: [{ type: 'command', command: 'private command' }] }}
      rules={rules}
      mode="presentation"
      onLaunch={jest.fn()}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Copied'));
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not copy'));
  expect(report.mock.calls).toEqual(
    ['success', 'error'].map((outcome) => [
      'kiosk_interaction',
      {
        launch_mode: 'presentation',
        block_index: 0,
        component: 'command',
        action: 'copy',
        outcome,
      },
    ])
  );
});

it('counts a data source selection without its selected name', async () => {
  Object.defineProperty(window, 'IntersectionObserver', {
    configurable: true,
    writable: true,
    value: jest.fn(() => ({ observe: jest.fn(), unobserve: jest.fn(), disconnect: jest.fn() })),
  });
  jest
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue({ measureText: () => ({ width: 100 }) } as unknown as CanvasRenderingContext2D);
  render(
    <KioskPage
      page={{
        version: 1,
        blocks: [
          {
            type: 'launch-form',
            ruleId: 'demo',
            label: 'Launch',
            inputs: [{ inputType: 'datasource', variableName: 'privateDatasource', prompt: 'Data source' }],
          },
        ],
      }}
      rules={rules}
      mode="instance"
      onLaunch={jest.fn()}
    />
  );
  fireEvent.click(screen.getByRole('combobox'));
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
  expect(report.mock.calls).toEqual([
    [
      'kiosk_interaction',
      {
        launch_mode: 'instance',
        block_index: 0,
        component: 'input',
        action: 'change',
        input_type: 'datasource',
        input_index: 0,
      },
    ],
  ]);
});

it('reports native required validation without submitting or recording content', () => {
  render(<KioskPage page={page} rules={rules} mode="instance" onLaunch={jest.fn()} />);
  fireEvent.invalid(screen.getByRole('textbox'));
  expect(report).toHaveBeenCalledWith('kiosk_interaction', {
    launch_mode: 'instance',
    block_index: 0,
    component: 'input',
    action: 'invalid',
    input_type: 'text',
    input_index: 0,
  });
  expect(prepare).not.toHaveBeenCalled();
});

it.each([
  [
    new KioskLaunchError('destination', 'input-format-mismatch', 'Private authoring details'),
    'destination',
    'input-format-mismatch',
  ],
  [new KioskLaunchError('prepare', 'fetch-failed', 'https://private.example'), 'prepare', 'fetch-failed'],
  [new KioskFormError('Private storage details', 'storage'), 'storage', 'write-failed'],
  [new Error('https://private.example'), 'launch', 'unexpected-error'],
])('logs bounded launch diagnostics without values or raw exceptions', async (error, stage, reason) => {
  prepare.mockRejectedValue(error);
  render(<KioskPage page={page} rules={rules} mode="instance" onLaunch={jest.fn()} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://private.example' } });
  fireEvent.click(screen.getByRole('button', { name: 'Launch' }));
  await screen.findByRole('alert');
  expect(logger.error).toHaveBeenLastCalledWith(`Kiosk guide launch failed: ${stage}/${reason}`, {
    stage,
    reason,
    launch_mode: 'instance',
  });
  expect(JSON.stringify(jest.mocked(logger.error).mock.calls)).not.toMatch(/private/i);
});

it('does not log ordinary invalid input as an operational failure', async () => {
  prepare.mockRejectedValue(new KioskFormError('Enter a valid origin'));
  render(<KioskPage page={page} rules={rules} mode="instance" onLaunch={jest.fn()} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'invalid' } });
  fireEvent.click(screen.getByRole('button', { name: 'Launch' }));
  await screen.findByRole('alert');
  expect(logger.error).not.toHaveBeenCalled();
});

it('launches without inputs silently while logging bounded diagnostics', async () => {
  const launch = {} as Awaited<ReturnType<typeof prepareKioskInputs>>['launch'];
  prepare.mockResolvedValue({ launch, inputTransfer: 'skipped', reason: 'input-format-mismatch' });
  render(<KioskPage page={page} rules={rules} mode="instance" onLaunch={jest.fn()} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://private.example' } });
  fireEvent.click(screen.getByRole('button', { name: 'Launch' }));
  await waitFor(() =>
    expect(launchKioskGuide).toHaveBeenCalledWith(rules[0], 'instance', expect.any(Function), launch)
  );
  expect(report).toHaveBeenLastCalledWith('kiosk_interaction', expect.objectContaining({ action: 'fallback' }));
  expect(JSON.stringify(jest.mocked(logger.warn).mock.calls)).not.toMatch(/private/i);
});

it('highlights Bash as inert code and supports plain text', () => {
  const command = 'echo "<img src=x onerror=alert(1)>"';
  const { rerender } = render(
    <KioskPage
      page={{ version: 1, blocks: [{ type: 'command', command, language: 'bash' }] }}
      rules={rules}
      mode="presentation"
      onLaunch={jest.fn()}
    />
  );
  expect(document.querySelector('code')?.textContent).toBe(command);
  expect(document.querySelector('code .token')).not.toBeNull();
  expect(document.querySelector('code img')).toBeNull();
  rerender(
    <KioskPage
      page={{ version: 1, blocks: [{ type: 'command', command: 'plain text', language: 'text' }] }}
      rules={rules}
      mode="presentation"
      onLaunch={jest.fn()}
    />
  );
  expect(document.querySelector('code')?.textContent).toBe('plain text');
  expect(document.querySelector('code .token')).toBeNull();
});
