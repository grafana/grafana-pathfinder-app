import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { RawContent } from '../../types/content.types';
import { guideCompletionMarkStorage } from '../../lib/user-storage';
import { evictAllContentCaches } from '../../global-state/completion-store';
import { resetContentKeyForTests } from '../../global-state/content-key';
import { trackedCompletion } from '../../test-utils/content-renderer-completion';
import { openLearningHome } from '../docs-panel/utils/open-catalog-browser';
import { ContentRenderer } from './content-renderer';

jest.mock('@grafana/i18n', () => ({ t: (_key: string, fallback: string) => fallback }));
jest.mock('../docs-panel/utils/open-catalog-browser', () => ({ openLearningHome: jest.fn() }));
jest.mock('../completion-panel/ReaderCompletionPanel', () => {
  throw new Error('Loading chunk completion-panel failed');
});

const content: RawContent = {
  content: '<p>A finished guide</p>',
  type: 'single-doc',
  url: 'bundled:completion-chunk-failure',
  lastFetched: '2026-10-27T00:00:00.000Z',
  metadata: { title: 'Guide' },
};

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  resetContentKeyForTests();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  evictAllContentCaches();
  localStorage.clear();
});

it('preserves completion and usable home navigation after the real lazy import rejects, with honest reload recovery', async () => {
  const onContinue = jest.fn();
  const onVisibility = jest.fn();
  const props = {
    content,
    completion: trackedCompletion(content),
    completionPanelEnabled: true,
    onContinueToNextMilestone: onContinue,
    onCompletionPanelVisibilityChange: onVisibility,
  };
  const { unmount } = render(<ContentRenderer {...props} />);
  const complete = await screen.findByRole('button', { name: 'Mark complete' });
  await waitFor(() => expect(complete).toBeEnabled());
  fireEvent.click(complete);
  expect(await screen.findByText('Completed. Next steps could not be loaded.')).toBeInTheDocument();
  expect(await guideCompletionMarkStorage.get(content.url)).toBe(true);
  expect(onContinue).not.toHaveBeenCalled();
  const home = screen.getByRole('button', { name: 'My learning' });
  fireEvent.click(home);
  expect(openLearningHome).toHaveBeenCalledWith({ source: 'content_completion_panel' });
  expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  jest.mocked(console.error).mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Reload page' }));
  expect(console.error).toHaveBeenCalledWith(
    expect.objectContaining({
      message: expect.stringContaining('Not implemented: navigation'),
    })
  );
  expect(onContinue).not.toHaveBeenCalled();
  unmount();
  expect(onVisibility).toHaveBeenLastCalledWith(false);
  await act(async () => {});
  render(<ContentRenderer {...props} />);
  expect(await screen.findByText('Completed. Next steps could not be loaded.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'My learning' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Mark complete' })).not.toBeInTheDocument();
});
