jest.mock('@playwright/test', () => ({
  Page: jest.fn(),
  Locator: jest.fn(),
  expect: jest.fn(),
  test: jest.fn(),
}));

import { classifyError } from './classification';

describe('classifyError', () => {
  it.each([
    'Timeout waiting for data-test-step-state="completed"',
    'Operation timed out after 30s',
    'Timeout exceeded while waiting for selector',
    'Request timeout',
  ])('keeps timeout pattern "%s" out of infrastructure classification', (errorMessage) => {
    expect(classifyError(errorMessage)).toBe('unknown');
  });

  it('classifies network failures as infrastructure', () => {
    expect(classifyError('net::ERR_CONNECTION_REFUSED')).toBe('infrastructure');
  });

  it('classifies closed browser targets as infrastructure', () => {
    expect(classifyError('Target page, context or browser has been closed')).toBe('infrastructure');
  });
});
