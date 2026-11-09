import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import fixture from '../../../pkg/plugin/testdata/contract/learning-insights.default.json';
import type { LearningInsightsResponse } from '../../types/learning-insights';
import { LearningInsightsView } from './LearningInsightsPage';

beforeAll(() => {
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    measureText: (text: string) => ({ width: text.length * 8 }),
  } as unknown as CanvasRenderingContext2D);
});
afterAll(() => jest.restoreAllMocks());

jest.mock('@grafana/runtime', () => ({ config: { bootData: { user: { orgRole: 'Admin' } } } }));

const ambiguous = (): LearningInsightsResponse => ({
  ...fixture,
  completeness: 'partial',
  warnings: ['journey-identity-ambiguous'],
  assignments: [],
});

test('uses the host page title and fills the host width on both tabs', () => {
  render(<LearningInsightsView data={fixture as LearningInsightsResponse} refresh={jest.fn()} />);
  const page = screen.getByRole('main', { name: 'Learning insights' });
  expect(screen.queryByRole('heading', { name: 'Learning insights' })).not.toBeInTheDocument();
  expect(getComputedStyle(page).width).toBe('100%');
  expect(getComputedStyle(page).backgroundColor).toBe('rgba(0, 0, 0, 0)');
  fireEvent.click(screen.getByRole('button', { name: 'Assignments and people' }));
  expect(screen.getByRole('main', { name: 'Learning insights' })).toBe(page);
  expect(getComputedStyle(page).width).toBe('100%');
});

test('removes the redundant date-range paragraph on both tabs', () => {
  render(<LearningInsightsView data={fixture as LearningInsightsResponse} refresh={jest.fn()} />);
  expect(screen.queryByText(/Dates and times shown|selected period includes its start/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Assignments and people' }));
  expect(screen.queryByText(/Dates and times shown|selected period includes its start/)).not.toBeInTheDocument();
});

test('journey exclusions do not add expandable explanations or page warnings', () => {
  render(<LearningInsightsView data={ambiguous()} refresh={jest.fn()} />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByText('About completion counts')).not.toBeInTheDocument();
  expect(screen.getByText('No assignments yet')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Assignments and people' }));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByText('About completion counts')).not.toBeInTheDocument();
});

test('actual incomplete loads still show recovery information', () => {
  render(
    <LearningInsightsView data={{ ...ambiguous(), warnings: ['assignments-fetch-failed'] }} refresh={jest.fn()} />
  );
  expect(screen.getByRole('status')).toHaveTextContent(/Assignment records could not all be loaded/);
  expect(screen.getByText('Assignment summary unavailable')).toBeInTheDocument();
  expect(screen.queryByText('No assignments yet')).not.toBeInTheDocument();
});
