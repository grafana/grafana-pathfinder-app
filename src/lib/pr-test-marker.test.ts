import {
  createPrTestFetchId,
  getPrTestFetchId,
  isPrTestUrl,
  stripPrTestMarker,
  withPrTestMarker,
} from './pr-test-marker';

const RAW = 'https://raw.githubusercontent.com/grafana/interactive-tutorials/abc123/guide-one/content.json';

describe('pr-test-marker', () => {
  it('round-trips a marker without touching the URL', () => {
    const marked = withPrTestMarker(RAW, 'k3x9a');
    expect(marked).toBe(`${RAW}#pf-pr-k3x9a`);
    expect(getPrTestFetchId(marked)).toBe('k3x9a');
    expect(isPrTestUrl(marked)).toBe(true);
    expect(stripPrTestMarker(marked)).toBe(RAW);
  });

  it('replaces an existing marker instead of stacking', () => {
    const remarked = withPrTestMarker(withPrTestMarker(RAW, 'first'), 'second');
    expect(remarked).toBe(`${RAW}#pf-pr-second`);
  });

  it('leaves unmarked URLs alone', () => {
    expect(isPrTestUrl(RAW)).toBe(false);
    expect(isPrTestUrl(`${RAW}#section`)).toBe(false);
    expect(isPrTestUrl(undefined)).toBe(false);
    expect(stripPrTestMarker(RAW)).toBe(RAW);
  });

  it('mints distinct ids per call', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createPrTestFetchId()));
    expect(ids.size).toBeGreaterThan(40);
    ids.forEach((id) => expect(id).toMatch(/^[a-z0-9]+$/));
  });
});
