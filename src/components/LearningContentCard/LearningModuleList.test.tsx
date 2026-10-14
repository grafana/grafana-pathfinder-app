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
