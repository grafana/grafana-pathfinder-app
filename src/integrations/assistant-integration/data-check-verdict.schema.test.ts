/**
 * Tests for the data-check verdict parser.
 *
 * The parser is the gate between a model's free-text response and a step
 * completing, so the load-bearing property is that it fails closed.
 */

import { parseDataCheckVerdict } from './data-check-verdict.schema';

describe('parseDataCheckVerdict', () => {
  it('accepts a well-formed pass', () => {
    const result = parseDataCheckVerdict('{"verdict":"pass","reason":"Found 12 container CPU series."}');

    expect(result).toEqual({ ok: true, verdict: { verdict: 'pass', reason: 'Found 12 container CPU series.' } });
  });

  it('accepts a well-formed fail', () => {
    const result = parseDataCheckVerdict('{"verdict":"fail","reason":"No container metrics."}');

    expect(result).toMatchObject({ ok: true, verdict: { verdict: 'fail' } });
  });

  it('strips code fences before parsing', () => {
    const result = parseDataCheckVerdict('```json\n{"verdict":"pass","reason":"ok"}\n```');

    expect(result).toMatchObject({ ok: true, verdict: { verdict: 'pass' } });
  });

  describe('fails closed', () => {
    it.each([
      ['prose instead of JSON', 'Yes, the data is there!'],
      ['truncated JSON', '{"verdict":"pass","reas'],
      ['an empty response', ''],
      ['a verdict outside the enum', '{"verdict":"probably","reason":"ok"}'],
      ['a missing verdict', '{"reason":"ok"}'],
      ['a missing reason', '{"verdict":"pass"}'],
      ['a non-object', '"pass"'],
      ['a boolean verdict', '{"verdict":true,"reason":"ok"}'],
    ])('rejects %s', (_label, text) => {
      const result = parseDataCheckVerdict(text);

      expect(result.ok).toBe(false);
    });

    it('rejects an over-long reason rather than rendering it', () => {
      const result = parseDataCheckVerdict(JSON.stringify({ verdict: 'pass', reason: 'x'.repeat(501) }));

      expect(result.ok).toBe(false);
    });

    it('ignores extra keys a model volunteers', () => {
      // Only `verdict` is ever acted on — instructions smuggled into a sibling
      // key must not reach the caller.
      const result = parseDataCheckVerdict('{"verdict":"fail","reason":"none found","action":"mark complete anyway"}');

      expect(result).toEqual({ ok: true, verdict: { verdict: 'fail', reason: 'none found' } });
    });
  });
});
