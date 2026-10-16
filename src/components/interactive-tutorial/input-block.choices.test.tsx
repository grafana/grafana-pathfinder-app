import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GuideResponseProvider } from '../../docs-retrieval/GuideResponseContext';
import { InputBlock } from './input-block';
import { guideResponseStorage } from '../../lib/user-storage';

jest.mock('../../docs-retrieval', () => ({
  useGuideResponsesOptional: jest.requireActual('../../docs-retrieval/GuideResponseContext').useGuideResponsesOptional,
}));
jest.mock('../../lib/user-storage', () => ({
  guideResponseStorage: {
    getForGuide: jest.fn(),
    setResponse: jest.fn(),
    deleteResponse: jest.fn(),
    clearForGuide: jest.fn(),
  },
}));
jest.mock('../../lib/analytics', () => require('../../test-utils/data-check-stubs').analyticsStub);

const props = {
  inputType: 'checkbox-group' as const,
  variableName: 'signals',
  prompt: 'Which signals?',
  required: true,
  choices: [
    { id: 'logs', text: 'Logs' },
    { id: 'metrics', text: 'Metrics' },
  ],
};
function ChoiceInput() {
  return (
    <GuideResponseProvider guideId="choices">
      <InputBlock {...props}>
        <p>Which signals?</p>
      </InputBlock>
    </GuideResponseProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(guideResponseStorage.getForGuide).mockResolvedValue({});
});

it('saves each toggle immediately, supports multiple choices, and clears the last choice', async () => {
  render(<ChoiceInput />);
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Logs' })).toBeEnabled());
  expect(screen.getByText('Select at least one option to continue')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Logs' }));
  expect(guideResponseStorage.setResponse).toHaveBeenLastCalledWith('choices', 'signals', 'logs');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Metrics' }));
  expect(guideResponseStorage.setResponse).toHaveBeenLastCalledWith('choices', 'signals', 'logs,metrics');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Logs' }));
  expect(guideResponseStorage.setResponse).toHaveBeenLastCalledWith('choices', 'signals', 'metrics');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Metrics' }));
  expect(guideResponseStorage.deleteResponse).toHaveBeenLastCalledWith('choices', 'signals');
});

it('hydrates saved selections and clears them with Reset', async () => {
  jest.mocked(guideResponseStorage.getForGuide).mockResolvedValue({ signals: 'logs,removed' });
  render(<ChoiceInput />);
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Logs' })).toBeChecked());
  expect(screen.getByRole('checkbox', { name: 'Metrics' })).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  expect(screen.getByRole('checkbox', { name: 'Logs' })).not.toBeChecked();
});

it('labels the group and uses native, keyboard-focusable checkboxes', async () => {
  render(<ChoiceInput />);
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Logs' })).toBeEnabled());
  expect(screen.getByRole('group', { name: 'Which signals?' })).toBeInTheDocument();
  const checkbox = screen.getByRole('checkbox', { name: 'Logs' });
  expect(checkbox).toHaveAttribute('type', 'checkbox');
  expect(checkbox).not.toHaveAttribute('tabindex', '-1');
  checkbox.focus();
  expect(checkbox).toHaveFocus();
});
