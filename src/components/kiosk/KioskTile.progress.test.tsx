import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { dispatchProgress } from '../../global-state/progress-events';
import { interactiveCompletionStorage, journeyCompletionStorage } from '../../lib/user-storage';
import { KioskTile } from './KioskTile';

jest.mock('./launch-kiosk-guide', () => ({ launchKioskGuide: jest.fn() }));
jest.mock('../../lib/user-storage', () => ({
  interactiveCompletionStorage: { get: jest.fn() },
  journeyCompletionStorage: { get: jest.fn() },
}));

const rule = { title: 'Example guide', description: 'Learn Grafana', type: 'interactive', url: 'bundled:example' };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(interactiveCompletionStorage.get).mockResolvedValue(0);
  jest.mocked(journeyCompletionStorage.get).mockResolvedValue(0);
});

it.each([0, 43, 100])('shows stored %i percent and a check only at completion', async (percentage) => {
  jest.mocked(interactiveCompletionStorage.get).mockResolvedValue(percentage);
  render(<KioskTile rule={rule} index={0} mode="instance" />);
  const status = await screen.findByText(`${percentage}% complete`);
  expect(status.parentElement).toHaveAttribute('data-complete', String(percentage === 100));
  expect(status.parentElement?.querySelector('svg') !== null).toBe(percentage === 100);
  expect(interactiveCompletionStorage.get).toHaveBeenCalledWith(rule.url);
});

it('refreshes completion and resets while mounted', async () => {
  render(<KioskTile rule={rule} index={0} mode="instance" />);
  await screen.findByText('0% complete');
  jest.mocked(interactiveCompletionStorage.get).mockResolvedValue(100);
  act(() => dispatchProgress({ kind: 'guide', contentKey: rule.url, percentage: 100, hasProgress: true }));
  await screen.findByText('100% complete');
  jest.mocked(interactiveCompletionStorage.get).mockResolvedValue(0);
  act(() => dispatchProgress({ kind: 'guide', contentKey: rule.url, percentage: 0, hasProgress: false }));
  await screen.findByText('0% complete');
});

it('uses the journey percentage for learning paths', async () => {
  jest.mocked(journeyCompletionStorage.get).mockResolvedValue(65);
  render(<KioskTile rule={{ ...rule, type: 'learning-journey' }} index={0} mode="instance" />);
  await screen.findByText('65% complete');
  expect(journeyCompletionStorage.get).toHaveBeenCalledWith(rule.url);
  expect(interactiveCompletionStorage.get).not.toHaveBeenCalled();
});

it('does not misrepresent local progress as progress on another instance', () => {
  render(<KioskTile rule={{ ...rule, targetUrl: 'https://other.grafana.net' }} index={0} mode="presentation" />);
  expect(screen.queryByText(/% complete/)).not.toBeInTheDocument();
  expect(interactiveCompletionStorage.get).not.toHaveBeenCalled();
});

it('reads the sanitized interactive completion key', async () => {
  const url = `https://example.com/${'a'.repeat(220)}..`;
  jest.mocked(interactiveCompletionStorage.get).mockResolvedValue(100);
  render(<KioskTile rule={{ ...rule, url }} index={0} mode="instance" />);
  await screen.findByText('100% complete');
  expect(interactiveCompletionStorage.get).toHaveBeenCalledWith(url.replace(/\.\./g, '').slice(0, 200));
});
