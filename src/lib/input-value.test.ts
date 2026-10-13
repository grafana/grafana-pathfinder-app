import { describeHttpInput, normalizeHttpOrigin, normalizeHttpUrl } from './input-value';

it.each([
  ['example.com', 'https://example.com/'],
  [' www.example.com/shop?q=boots#details ', 'https://www.example.com/shop?q=boots'],
  ['\nhttps://example.com/\t', 'https://example.com/'],
  ['http://example.com:8080/a?x=1&y=2', 'http://example.com:8080/a?x=1&y=2'],
  ['example.com:8443/a', 'https://example.com:8443/a'],
  ['localhost:3000/a', 'https://localhost:3000/a'],
  ['http://localhost:3000', 'http://localhost:3000/'],
  ['http://intranet/health', 'http://intranet/health'],
  ['https://[::1]:3000/a', 'https://[::1]:3000/a'],
  ['//example.com/a', 'https://example.com/a'],
  ['HTTPS://EXAMPLE.COM:443/', 'https://example.com/'],
])('normalizes %s without losing its HTTP request path or query', (value, expected) => {
  expect(normalizeHttpUrl(value)).toBe(expected);
  expect(normalizeHttpOrigin(value)).toBe(new URL(expected).origin);
});

it.each([
  '',
  ' ',
  'not a url',
  'not-a-url',
  'https://',
  'https:///example.com',
  'https:example.com',
  'ftp://example.com',
  'javascript:alert(1)',
  'data:text/plain,hello',
  'https://@example.com',
  `https://${'user'}:${'pass'}@example.com`,
  'https://example.com\\path',
  'https://exa\nmple.com',
  'https://*.example.com',
  'https://-example.com',
  'https://example..com',
  'https://example.com:99999',
  'https://' + 'a'.repeat(2048),
])('rejects malformed or unsafe website input %s', (value) => {
  expect(normalizeHttpUrl(value)).toBeNull();
  expect(normalizeHttpOrigin(value)).toBeNull();
});

it('explains the actual check and allowed origin before submission', () => {
  expect(describeHttpInput('example.com/shop?q=1#top', 'http-url')).toBe(
    'Check: https://example.com/shop?q=1 · Allowed origin: https://example.com'
  );
  expect(describeHttpInput('example.com/shop', 'http-origin')).toBe('Allowed origin: https://example.com');
  expect(describeHttpInput('not a url', 'http-url')).toBeUndefined();
  expect(describeHttpInput('example.com')).toBeUndefined();
});
