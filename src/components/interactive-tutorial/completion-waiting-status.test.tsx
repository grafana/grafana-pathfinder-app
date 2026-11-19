import React from 'react';
import { render, screen } from '@testing-library/react';
import { CompletionWaitingStatus } from './completion-waiting-status';

jest.mock('../../requirements-manager', () => {
  const actual = jest.requireActual('../../requirements-manager');
  return {
    getPostVerifyExplanation: (token: string) => {
      if (token === 'has-datasources') {
        return 'Add a data source';
      }
      if (token.startsWith('on-page:')) {
        return actual.getPostVerifyExplanation(token);
      }
      return 'Requirement "' + token + '" needs to be satisfied';
    },
  };
});

it('uses a generic status instead of exposing an unmapped objective token', () => {
  render(<CompletionWaitingStatus id="step" unmet="has-dashboard-named:Private" onCheck={jest.fn()} />);
  expect(screen.getByRole('status')).toHaveTextContent('Waiting for completion');
  expect(screen.getByRole('status')).not.toHaveTextContent('Private');
});

it('shows a friendly explanation for a known objective', () => {
  render(<CompletionWaitingStatus id="step" unmet="has-datasources" onCheck={jest.fn()} />);
  expect(screen.getByRole('status')).toHaveTextContent('Waiting for completion: Add a data source');
});

it('shows quotes and slashes in the explanation as plain text', () => {
  render(<CompletionWaitingStatus id="step" unmet="on-page:/connections" onCheck={jest.fn()} />);
  expect(screen.getByRole('status')).toHaveTextContent(
    "Waiting for completion: Navigate to the '/connections' page first."
  );
});
