import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createTranslatedComponent } from './TranslatedComponent';
import { loadTranslatedModule } from '../../lib/plugin-translations';

jest.mock('../../lib/plugin-translations', () => ({
  loadTranslatedModule: jest.fn(async (load: () => Promise<unknown>) => load()),
}));
jest.mock('../../lib/logging', () => ({ logger: { exception: jest.fn() } }));

beforeEach(() => jest.clearAllMocks());

it('does not load until mounted and preserves props after loading', async () => {
  const load = jest.fn(async () => ({ default: ({ label }: { label: string }) => <div>{label}</div> }));
  const View = createTranslatedComponent(load);
  expect(load).not.toHaveBeenCalled();
  render(<View label="Loaded settings" />);
  expect(await screen.findByText('Loaded settings')).toBeInTheDocument();
  expect(loadTranslatedModule).toHaveBeenCalledTimes(1);
});

it('shows a loader while waiting and shares the load between simultaneous mounts', async () => {
  let finish!: (value: { default: React.ComponentType }) => void;
  const load = jest.fn(() => new Promise<{ default: React.ComponentType }>((resolve) => (finish = resolve)));
  const View = createTranslatedComponent(load);
  render(
    <>
      <View />
      <View />
    </>
  );
  expect(screen.getAllByText('Loading interactive learning')).toHaveLength(2);
  await act(async () => finish({ default: () => <div>Ready</div> }));
  expect(screen.getAllByText('Ready')).toHaveLength(2);
  expect(load).toHaveBeenCalledTimes(1);
});

it('offers a working retry after a rejected lazy load', async () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const load = jest
      .fn()
      .mockRejectedValueOnce(new Error('Exhausted retries'))
      .mockResolvedValue({ default: () => <div>Recovered</div> });
    const View = createTranslatedComponent(load);
    const first = render(<View />);
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Recovered')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
    first.unmount();
    render(<View />);
    expect(await screen.findByText('Recovered')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  } finally {
    consoleError.mockRestore();
  }
});
