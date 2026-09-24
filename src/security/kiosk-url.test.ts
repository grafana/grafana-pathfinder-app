import { parseKioskWebUrl, validateKioskOverride } from './kiosk-url';

const origin = 'https://stack.grafana.net';
const configured = 'https://catalog.example.com/default.json';

describe('kiosk URL validation', () => {
  it.each([
    'https://interactive-learning.grafana.net/custom.json',
    'https://stack.grafana.net/custom.json',
    'https://catalog.example.com/custom.json',
  ])('allows trusted origin %s', (url) => {
    expect(validateKioskOverride(url, configured, origin)).toBe(url);
  });

  it.each([
    'https://evil.example.com/custom.json',
    'https://interactive-learning.grafana.net.evil.com/custom.json',
    'https://catalog.example.com:444/custom.json',
    'https://user:password@catalog.example.com/custom.json',
    'http://catalog.example.com/custom.json',
    'javascript:alert(1)',
    'data:application/json,{}',
    '/relative.json',
    'invalid',
  ])('rejects untrusted or unsafe URL %s', (url) => {
    expect(validateKioskOverride(url, configured, origin)).toBeNull();
  });

  it('allows HTTP only for same-origin localhost development', () => {
    expect(parseKioskWebUrl('http://localhost:3000/kiosk.json', 'http://localhost:3000')).not.toBeNull();
    expect(parseKioskWebUrl('http://localhost:3001/kiosk.json', 'http://localhost:3000')).toBeNull();
    expect(parseKioskWebUrl('http://stack.example.com/kiosk.json', 'http://stack.example.com')).toBeNull();
    expect(validateKioskOverride('http://localhost:3000/kiosk.json', '', 'http://localhost:3000')).not.toBeNull();
  });

  it('does not trust a malformed or credential-bearing default origin', () => {
    expect(
      validateKioskOverride(configured, 'https://user:password@catalog.example.com/default.json', origin)
    ).toBeNull();
  });
});
