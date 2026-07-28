jest.mock('@playwright/test', () => ({
  Page: jest.fn(),
  Locator: jest.fn(),
  expect: jest.fn(),
  test: jest.fn(),
}));

import { classifyError } from './classification';

describe('classifyError', () => {
  it('keeps step completion timeouts out of infrastructure classification', () => {
    expect(classifyError('Timeout waiting for data-test-step-state="completed"')).toBe('unknown');
  });

  it('classifies network failures as infrastructure', () => {
    expect(classifyError('net::ERR_CONNECTION_REFUSED')).toBe('infrastructure');
  });

  it('classifies closed browser targets as infrastructure', () => {
    expect(classifyError('Target page, context or browser has been closed')).toBe('infrastructure');
  });
});
