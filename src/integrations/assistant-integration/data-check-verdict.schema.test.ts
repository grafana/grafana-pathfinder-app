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

  it('finds the verdict behind a preamble and a code fence', () => {
    const result = parseDataCheckVerdict(
      'Perfect! The query returned data, confirming Kubernetes metrics are present.\n\n' +
        '```json\n{ "verdict": "pass", "reason": "Found kube_pod_info." }\n```'
    );

    expect(result).toEqual({ ok: true, verdict: { verdict: 'pass', reason: 'Found kube_pod_info.' } });
  });

  it('finds an unfenced verdict behind a preamble', () => {
    const result = parseDataCheckVerdict('I checked the labels. {"verdict":"fail","reason":"No series."}');

    expect(result).toMatchObject({ ok: true, verdict: { verdict: 'fail' } });
  });

  it('takes the closing verdict when the preamble quotes the shape', () => {
    const result = parseDataCheckVerdict(
      'I must answer with {"verdict":"pass","reason":"example"} once done.\n' +
        '{"verdict":"fail","reason":"Nothing matched."}'
    );

    expect(result).toMatchObject({ ok: true, verdict: { verdict: 'fail', reason: 'Nothing matched.' } });
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
      ['prose asserting a pass without the JSON', 'Yes! The data is present, so this is a pass.'],
      ['a truncated verdict behind a preamble', 'Looks good so far: {"verdict":"pass","reas'],
      ['a fenced block that is not a verdict', 'Here is what I ran:\n```promql\nup{job="x"}\n```'],
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
