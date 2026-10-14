import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Milestone, RawContent } from '../../types/content.types';
import { CompletionPanel } from './CompletionPanel';
import { openCatalogBrowser } from '../docs-panel/utils/open-catalog-browser';

let browseEnabled = true;
jest.mock('../../utils/openfeature', () => ({ useBooleanFlag: () => browseEnabled }));
jest.mock('../docs-panel/utils/open-catalog-browser', () => ({ openCatalogBrowser: jest.fn() }));
jest.mock('./CompletionSuggestions', () => ({ CompletionSuggestions: () => <div>Related content</div> }));
jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values?.[key] ?? '')),
}));
const content: RawContent = {
  content: '{}',
  metadata: { title: 'Completed guide' },
  url: 'bundled:first-dashboard',
  type: 'interactive',
  lastFetched: '',
};
const nextModule: Milestone = {
  title: 'Add your next panel',
  number: 2,
  url: 'bundled:next',
  isActive: false,
  description: 'Use an existing data source.',
};
beforeEach(() => {
  browseEnabled = true;
  jest.clearAllMocks();
});

it('shows the exact next module without catalog recommendations and keeps review available', () => {
  const onContinue = jest.fn();
  const onReview = jest.fn();
  render(
    <CompletionPanel
      content={content}
      nextModule={nextModule}
      onContinue={onContinue}
      onReview={onReview}
      moduleContext={{ position: 1, total: 3 }}
    />
  );
  expect(screen.getByRole('heading', { name: 'Module complete' })).toBeInTheDocument();
  expect(screen.getByText('Module 1 of 3')).toBeInTheDocument();
  expect(screen.getByText(nextModule.title)).toBeInTheDocument();
  expect(screen.queryByText('Related content')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Continue to next module' }));
  expect(onContinue).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Review this guide' }));
  expect(onReview).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Explore learning' }));
  expect(openCatalogBrowser).toHaveBeenCalledWith({ source: 'content_completion_panel' });
});

it('retains completion when a next-module launch fails and permits retry', async () => {
  const onContinue = jest.fn().mockRejectedValue(new Error('offline'));
  render(<CompletionPanel content={content} nextModule={nextModule} onContinue={onContinue} onReview={jest.fn()} />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Continue to next module' }));
  });
  expect(screen.getByRole('heading', { name: 'Guide complete' })).toBeInTheDocument();
  expect(screen.getByText('Unable to open this module. Try again.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Continue to next module' })).toBeEnabled();
});

it('blocks unavailable modules', () => {
  const onContinue = jest.fn();
  render(
    <CompletionPanel
      content={content}
      nextModule={{ ...nextModule, isLocked: true }}
      onContinue={onContinue}
      onReview={jest.fn()}
    />
  );
  expect(screen.getByRole('button', { name: 'Continue to next module' })).toBeDisabled();
  expect(screen.getByText('This module is currently unavailable.')).toBeInTheDocument();
});

it('shows path completion only when confirmed', () => {
  render(
    <CompletionPanel
      content={content}
      onReview={jest.fn()}
      moduleContext={{ position: 3, total: 3, pathComplete: true }}
    />
  );
  expect(screen.getByRole('heading', { name: 'Path complete' })).toBeInTheDocument();
});

it('does not mount related content or offer Browse when its flag is off', () => {
  browseEnabled = false;
  render(<CompletionPanel content={content} onReview={jest.fn()} />);
  expect(screen.queryByText('Related content')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Explore learning' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Review this guide' })).toBeInTheDocument();
});

it('reports exposure only after the panel intersects the viewport and only once', () => {
  const observe = jest.fn();
  const disconnect = jest.fn();
  let callback: IntersectionObserverCallback | undefined;
  const original = global.IntersectionObserver;
  global.IntersectionObserver = jest.fn().mockImplementation((cb) => {
    callback = cb;
    return { observe, disconnect };
  });
  try {
    const onView = jest.fn();
    render(<CompletionPanel content={content} onReview={jest.fn()} onView={onView} />);
    expect(onView).not.toHaveBeenCalled();
    callback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    callback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(onView).toHaveBeenCalledTimes(1);
  } finally {
    global.IntersectionObserver = original;
  }
});
