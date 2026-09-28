import { MAX_ID_BYTES, MAX_TITLE_BYTES, isValidIdentifier, normalizeField } from './completion-write-normalize';

const CONTROL = String.fromCharCode(7); // BEL
const NUL = String.fromCharCode(0);
const DEL = String.fromCharCode(127);

describe('normalizeField', () => {
  it('passes a short clean value through unchanged', () => {
    expect(normalizeField('app-platform', MAX_ID_BYTES)).toBe('app-platform');
  });

  it('strips C0 control characters and DEL', () => {
    expect(normalizeField(`a${CONTROL}b${NUL}c${DEL}`, MAX_ID_BYTES)).toBe('abc');
  });

  it('clamps to the byte ceiling', () => {
    const clamped = normalizeField('x'.repeat(5000), MAX_TITLE_BYTES);
    expect(clamped.length).toBe(MAX_TITLE_BYTES);
  });

  it('does not split a multi-byte code point at the boundary', () => {
    // '😀' is 4 UTF-8 bytes; a 3-byte ceiling must drop it entirely, not corrupt it.
    const out = normalizeField('😀', 3);
    expect(out).toBe('');
  });
});

describe('isValidIdentifier', () => {
  it('accepts a non-empty identifier', () => {
    expect(isValidIdentifier('guide-1')).toBe(true);
  });

  it('rejects empty and control-only identifiers', () => {
    expect(isValidIdentifier('')).toBe(false);
    expect(isValidIdentifier(CONTROL + NUL)).toBe(false);
  });
});
