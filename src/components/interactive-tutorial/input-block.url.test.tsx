import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { reportAppInteraction } from '../../lib/analytics';
import { InputBlock } from './input-block';

const mockSetResponse = jest.fn();
const mockContext = {
  getResponse: () => undefined,
  setResponse: mockSetResponse,
  deleteResponse: jest.fn(),
  hasResponse: () => false,
  isLoading: false,
};
jest.mock('../../docs-retrieval', () => ({ useGuideResponsesOptional: () => mockContext }));
jest.mock('../../lib/analytics', () => require('../../test-utils/data-check-stubs').analyticsStub);
jest.mock('./datasource-options', () => ({ filterDatasourcesByType: () => [], toDatasourceOptions: () => [] }));

beforeEach(() => jest.clearAllMocks());

it.each([
  ['http-url', 'https://example.com:8443/shop?q=1'],
  ['http-origin', 'https://example.com:8443'],
] as const)('previews and saves a pasted website with format %s', (format, saved) => {
  render(<InputBlock prompt="Your website" inputType="text" format={format} variableName="appUrl" required />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: ' example.com:8443/shop?q=1#details ' } });
  expect(
    screen.getByText(
      format === 'http-url'
        ? 'Check: https://example.com:8443/shop?q=1 · Allowed origin: https://example.com:8443'
        : 'Allowed origin: https://example.com:8443'
    )
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Save/ }));
  expect(mockSetResponse).toHaveBeenCalledWith('appUrl', saved);
});

it('keeps invalid input unsaved and permits correction without exposing it in analytics', () => {
  render(<InputBlock prompt="Your website" inputType="text" format="http-url" variableName="appUrl" required />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'javascript:alert(1)' } });
  fireEvent.click(screen.getByRole('button', { name: /Save/ }));
  expect(mockSetResponse).not.toHaveBeenCalled();
  expect(screen.getByText(/Enter a website address/)).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'example.com/health' } });
  fireEvent.click(screen.getByRole('button', { name: /Save/ }));
  expect(mockSetResponse).toHaveBeenCalledWith('appUrl', 'https://example.com/health');
  expect(reportAppInteraction).toHaveBeenCalledWith('input_block_submit', {
    input_type: 'text',
    variable_name: 'appUrl',
    is_update: false,
  });
});
