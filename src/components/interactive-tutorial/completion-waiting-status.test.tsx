import React from 'react';
import { render, screen } from '@testing-library/react';
import { CompletionWaitingStatus } from './completion-waiting-status';

jest.mock('../../requirements-manager', () => ({
  getPostVerifyExplanation: (token: string) =>
    token === 'has-datasources' ? 'Add a data source' : 'Requirement "' + token + '" needs to be satisfied',
}));

it('uses a generic status instead of exposing an unmapped objective token', () => {
  render(<CompletionWaitingStatus id="step" unmet="has-dashboard-named:Private" onCheck={jest.fn()} />);
  expect(screen.getByRole('status')).toHaveTextContent('Waiting for completion');
  expect(screen.getByRole('status')).not.toHaveTextContent('Private');
});

it('shows a friendly explanation for a known objective', () => {
  render(<CompletionWaitingStatus id="step" unmet="has-datasources" onCheck={jest.fn()} />);
  expect(screen.getByRole('status')).toHaveTextContent('Waiting for completion: Add a data source');
});
