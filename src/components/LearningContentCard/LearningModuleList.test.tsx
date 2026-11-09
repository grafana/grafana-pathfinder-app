import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { LearningModuleList } from './LearningModuleList';
import type { Milestone } from '../../types/content.types';

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values?.[key] ?? '')),
}));
const modules: Milestone[] = [
  {
    id: 'welcome',
    number: 1,
    title: 'Welcome to Grafana',
    url: 'bundled:welcome',
    isActive: false,
    estimatedMinutes: 5,
  },
  { id: 'dashboard', number: 2, title: 'Create a dashboard', url: '', isActive: false, isLocked: true },
];

it('shows known module progress and availability without making a preview navigable', () => {
  render(<LearningModuleList modules={modules} progress={{ welcome: 100 }} />);
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  expect(screen.getByText('Completed')).toBeInTheDocument();
  expect(screen.getByText('Unavailable')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('preserves member navigation and keeps unpublished members disabled', () => {
  const onOpen = jest.fn();
  render(<LearningModuleList modules={modules} onOpen={onOpen} />);
  expect(screen.getByRole('button', { name: /Create a dashboard/ })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /Welcome to Grafana/ }));
  expect(onOpen).toHaveBeenCalledWith(modules[0]);
});

it('hides module descriptions in the compact list but keeps every member and its navigation', () => {
  const onOpen = jest.fn();
  const described: Milestone[] = [{ ...modules[0]!, description: 'A tour of the key areas' }, modules[1]!];
  const { rerender } = render(<LearningModuleList modules={described} onOpen={onOpen} />);
  expect(screen.getByText('A tour of the key areas')).toBeInTheDocument();

  rerender(<LearningModuleList compact modules={described} onOpen={onOpen} />);
  expect(screen.queryByText('A tour of the key areas')).not.toBeInTheDocument();
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: /Welcome to Grafana/ }));
  expect(onOpen).toHaveBeenCalledWith(described[0]);
});

describe('the milestone to resume at', () => {
  const sequence: Milestone[] = [
    { id: 'one', number: 1, title: 'One', url: 'backend-guide:one', isActive: false },
    { id: 'two', number: 2, title: 'Two', url: 'backend-guide:two', isActive: false, estimatedMinutes: 10 },
    { id: 'three', number: 3, title: 'Three', url: 'backend-guide:three', isActive: false },
  ];

  afterEach(() => jest.restoreAllMocks());

  it('is labelled up next and announced as the current step, navigable or not', () => {
    const { rerender } = render(
      <LearningModuleList compact modules={sequence} progress={{ one: 100 }} currentIndex={1} onOpen={jest.fn()} />
    );
    const current = screen.getByRole('button', { name: /Two/ });
    expect(current).toHaveAttribute('aria-current', 'step');
    expect(current).toHaveTextContent('Up next');
    expect(current).not.toHaveTextContent('10 min');
    expect(screen.getByRole('button', { name: /One/ })).not.toHaveAttribute('aria-current');

    rerender(<LearningModuleList modules={sequence} currentIndex={1} />);
    expect(screen.getByText('Up next').closest('[aria-current]')).toHaveTextContent('Two');
  });

  it('is never a completed or unpublished member', () => {
    const locked = sequence.map((member, index) => (index === 2 ? { ...member, isLocked: true } : member));
    const { rerender } = render(
      <LearningModuleList modules={locked} progress={{ one: 100 }} currentIndex={0} onOpen={jest.fn()} />
    );
    expect(screen.queryByText('Up next')).not.toBeInTheDocument();

    rerender(<LearningModuleList modules={locked} currentIndex={2} onOpen={jest.fn()} />);
    expect(screen.queryByText('Up next')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Three/ })).toBeDisabled();
  });

  it('scrolls into view inside a compact list, keeping half of the row before it visible', () => {
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40);
    jest.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
      return this.tagName === 'LI' ? 4 + 40 * Array.from(this.parentElement!.children).indexOf(this) : 0;
    });

    render(<LearningModuleList compact modules={sequence} currentIndex={2} onOpen={jest.fn()} />);

    expect(screen.getByRole('list').scrollTop).toBe(64);
  });
});
