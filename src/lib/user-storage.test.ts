import { wrapEnvelope, unwrapEnvelope } from './user-storage';

// ============================================================================
// ENVELOPE FORMAT TESTS
// ============================================================================

describe('wrapEnvelope', () => {
  it('should wrap a value and timestamp into a JSON envelope', () => {
    const result = wrapEnvelope('{"foo":"bar"}', 1700000000000);
    const parsed = JSON.parse(result);
    expect(parsed).toEqual({ v: '{"foo":"bar"}', t: 1700000000000 });
  });

  it('should handle empty string values (deletions)', () => {
    const result = wrapEnvelope('', 1700000000000);
    const parsed = JSON.parse(result);
    expect(parsed).toEqual({ v: '', t: 1700000000000 });
  });

  it('should produce valid JSON', () => {
    const result = wrapEnvelope('"hello"', 12345);
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('should handle values with special characters', () => {
    const value = '{"url":"https://example.com/path?q=1&b=2"}';
    const result = wrapEnvelope(value, 999);
    const parsed = JSON.parse(result);
    expect(parsed.v).toBe(value);
    expect(parsed.t).toBe(999);
  });
});

describe('unwrapEnvelope', () => {
  it('should unwrap a valid envelope', () => {
    const envelope = JSON.stringify({ v: '{"foo":"bar"}', t: 1700000000000 });
    const result = unwrapEnvelope(envelope);
    expect(result).toEqual({ v: '{"foo":"bar"}', t: 1700000000000 });
  });

  it('should unwrap an envelope with empty value (deletion)', () => {
    const envelope = JSON.stringify({ v: '', t: 1700000000000 });
    const result = unwrapEnvelope(envelope);
    expect(result).toEqual({ v: '', t: 1700000000000 });
  });

  it('should return null for null input', () => {
    expect(unwrapEnvelope(null)).toBeNull();
  });

  it('should return null for undefined input', () => {
    expect(unwrapEnvelope(undefined)).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(unwrapEnvelope('')).toBeNull();
  });

  it('should return null for non-JSON strings (old-format raw data)', () => {
    // Old format: raw serialized value without envelope
    expect(unwrapEnvelope('{"foo":"bar"}')).toBeNull();
    expect(unwrapEnvelope('"just a string"')).toBeNull();
    expect(unwrapEnvelope('12345')).toBeNull();
  });

  it('should return null for objects missing the "v" field', () => {
    const noV = JSON.stringify({ t: 1700000000000 });
    expect(unwrapEnvelope(noV)).toBeNull();
  });

  it('should return null for objects missing the "t" field', () => {
    const noT = JSON.stringify({ v: '{"foo":"bar"}' });
    expect(unwrapEnvelope(noT)).toBeNull();
  });

  it('should return null for objects where "t" is not a number', () => {
    const stringT = JSON.stringify({ v: 'data', t: '1700000000000' });
    expect(unwrapEnvelope(stringT)).toBeNull();
  });

  it('should return null for arrays', () => {
    expect(unwrapEnvelope('[1,2,3]')).toBeNull();
  });

  it('should return null for invalid JSON', () => {
    expect(unwrapEnvelope('{broken json')).toBeNull();
  });

  it('should roundtrip with wrapEnvelope', () => {
    const original = '{"tabs":[{"id":"tab-1","title":"Test"}]}';
    const timestamp = Date.now();
    const wrapped = wrapEnvelope(original, timestamp);
    const unwrapped = unwrapEnvelope(wrapped);

    expect(unwrapped).not.toBeNull();
    expect(unwrapped!.v).toBe(original);
    expect(unwrapped!.t).toBe(timestamp);
  });

  it('should distinguish envelope from old-format JSON objects', () => {
    // Old format: a raw JSON object stored without envelope
    // This has "v" and "t" but "t" is a string, not a number
    const oldFormat = JSON.stringify({ v: 'data', t: 'not-a-number' });
    expect(unwrapEnvelope(oldFormat)).toBeNull();

    // A real envelope has a numeric timestamp
    const newFormat = JSON.stringify({ v: 'data', t: 42 });
    expect(unwrapEnvelope(newFormat)).toEqual({ v: 'data', t: 42 });
  });
});
