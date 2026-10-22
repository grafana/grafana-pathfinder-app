import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import fixture from '../../../pkg/plugin/testdata/contract/learning-insights.default.json';
import type { LearningInsightsResponse } from '../../types/learning-insights';
import { LearningInsightsView } from './LearningInsightsPage';

jest.mock('@grafana/runtime', () => ({ config: { bootData: { user: { orgRole: 'Admin' } } } }));

const ambiguous = (): LearningInsightsResponse => ({
  ...fixture,
  completeness: 'partial',
  warnings: ['journey-identity-ambiguous'],
  assignments: [],
});

test('removes the redundant date-range paragraph on both tabs', () => {
  render(<LearningInsightsView data={fixture as LearningInsightsResponse} refresh={jest.fn()} />);
  expect(screen.queryByText(/Dates and times shown|selected period includes its start/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Assignments and people' }));
  expect(screen.queryByText(/Dates and times shown|selected period includes its start/)).not.toBeInTheDocument();
});

test('journey exclusions are quiet contextual details rather than a page warning', () => {
  render(<LearningInsightsView data={ambiguous()} refresh={jest.fn()} />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  const disclosure = screen.getByText('About completion counts').closest('details');
  expect(disclosure).not.toHaveAttribute('open');
  fireEvent.click(screen.getByText('About completion counts'));
  expect(disclosure).toHaveAttribute('open');
  expect(screen.getByText(/Older journey records with unclear guide identity are excluded/)).toBeInTheDocument();
  expect(screen.getByText('No assignments yet')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Assignments and people' }));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByText('About completion counts')).toBeInTheDocument();
});

test('actual incomplete loads still show recovery information', () => {
  render(
    <LearningInsightsView data={{ ...ambiguous(), warnings: ['assignments-fetch-failed'] }} refresh={jest.fn()} />
  );
  expect(screen.getByRole('status')).toHaveTextContent(/Assignment records could not all be loaded/);
  expect(screen.getByText('Assignment summary unavailable')).toBeInTheDocument();
  expect(screen.queryByText('No assignments yet')).not.toBeInTheDocument();
});
