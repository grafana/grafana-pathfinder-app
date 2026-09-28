import { formatVmExpiry, parseVmExpiry } from './vm-expiry';

describe('parseVmExpiry', () => {
  it('parses an RFC 3339 expiry', () => {
    expect(parseVmExpiry('2026-09-14T12:00:00Z')).toBe(Date.parse('2026-09-14T12:00:00Z'));
  });

  it.each([undefined, null, '', '0001-01-01T00:00:00Z', 'not-a-date'])('treats %p as unknown', (value) => {
    expect(parseVmExpiry(value)).toBeNull();
  });
});

describe('formatVmExpiry', () => {
  const now = Date.parse('2026-09-14T11:30:00Z');

  it('rounds up remaining minutes so the display never says zero', () => {
    expect(formatVmExpiry('2026-09-14T11:31:01Z', now)).toBe('2 min left');
  });

  it('reports an expired VM', () => {
    expect(formatVmExpiry('2026-09-14T11:29:59Z', now)).toBe('Session expired');
  });

  it('does not display a claim when expiry is unknown', () => {
    expect(formatVmExpiry('0001-01-01T00:00:00Z', now)).toBeNull();
  });
});
