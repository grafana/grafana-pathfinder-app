import { extractVariables, findMissingVariables, hasVariables, substituteVariables } from './variable-substitution';

it('derives the exact origin from the same saved URL used for an HTTP check', () => {
  const content = 'Check: {{appUrl}} · Allowed origin: {{appUrl:origin}}';
  expect(substituteVariables(content, { appUrl: 'https://example.com:8443/shop?q=1' })).toBe(
    'Check: https://example.com:8443/shop?q=1 · Allowed origin: https://example.com:8443'
  );
  expect(substituteVariables('{{appUrl:origin}}', { appUrl: 'https://other.example/new' })).toBe(
    'https://other.example'
  );
  expect(extractVariables(content)).toEqual(['appUrl']);
  expect(hasVariables('{{appUrl:origin}}')).toBe(true);
  expect(findMissingVariables(content, {})).toEqual(['appUrl']);
});
it('does not treat missing or unsafe URL responses as an allowed origin', () => {
  for (const value of [true, 42, 'javascript:alert(1)', 'not a url']) {
    expect(substituteVariables('{{appUrl:origin}}', { appUrl: value })).toBe('[not set]');
  }
  expect(substituteVariables('{{appUrl:origin}}', {}, { preserveUnmatched: true })).toBe('{{appUrl:origin}}');
});
it('keeps existing plain values and unknown modifiers unchanged', () => {
  expect(
    substituteVariables('{{name}} {{flag}} {{count}} {{appUrl:unknown}}', { name: 'demo', flag: false, count: 2 })
  ).toBe('demo false 2 {{appUrl:unknown}}');
});
