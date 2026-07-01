import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { resolveSelectorPipeline } from './selector-pipeline';

describe('resolveSelectorPipeline', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('resolves a single string selector with selectedIndex 0', async () => {
    document.body.innerHTML = '<div id="a"></div>';
    const result = await resolveSelectorPipeline({ reftarget: '#a', delays: [] });
    expect(result?.element.id).toBe('a');
    expect(result?.selectedIndex).toBe(0);
    expect(result?.strategy).toBe('exact');
  });

  it('uses the first matching candidate in an array', async () => {
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>';
    const result = await resolveSelectorPipeline({ reftarget: ['#a', '#b'], delays: [] });
    expect(result?.element.id).toBe('a');
    expect(result?.selectedIndex).toBe(0);
  });

  it('prefers the primary even when a fallback also matches', async () => {
    document.body.innerHTML = '<div id="primary"></div><div id="fallback"></div>';
    const result = await resolveSelectorPipeline({ reftarget: ['#primary', '#fallback'], delays: [] });
    expect(result?.element.id).toBe('primary');
    expect(result?.selectedIndex).toBe(0);
  });

  it('falls back to a later candidate when earlier ones miss', async () => {
    document.body.innerHTML = '<div id="fallback"></div>';
    const result = await resolveSelectorPipeline({ reftarget: ['#missing', '#fallback'], delays: [] });
    expect(result?.element.id).toBe('fallback');
    expect(result?.selectedIndex).toBe(1);
  });

  it('supports a mixed button-text + CSS fallback chain', async () => {
    document.body.innerHTML = '<div id="real"></div>';
    const result = await resolveSelectorPipeline({
      reftarget: ['Nonexistent label', '#real'],
      action: 'button',
      delays: [],
    });
    expect(result?.element.id).toBe('real');
    expect(result?.selectedIndex).toBe(1);
  });

  it('returns null for empty or whitespace-only input', async () => {
    expect(await resolveSelectorPipeline({ reftarget: '', delays: [] })).toBeNull();
    expect(await resolveSelectorPipeline({ reftarget: [], delays: [] })).toBeNull();
    expect(await resolveSelectorPipeline({ reftarget: ['', '   '], delays: [] })).toBeNull();
  });

  it('returns null when no candidate matches', async () => {
    const result = await resolveSelectorPipeline({ reftarget: ['#nope1', '#nope2'], delays: [] });
    expect(result).toBeNull();
  });

  it('exhausts the primary full retry budget before trying a fallback (selector-major)', async () => {
    jest.useFakeTimers();
    try {
      // Fallback is present from the start; primary never appears.
      document.body.innerHTML = '<div id="fallback"></div>';
      const promise = resolveSelectorPipeline({ reftarget: ['#missing', '#fallback'], delays: [50] });

      let settled = false;
      void promise.then(() => {
        settled = true;
      });

      // Parked at the primary's retry sleep — the already-present fallback must not win yet.
      await Promise.resolve();
      expect(settled).toBe(false);

      await jest.advanceTimersByTimeAsync(50);
      const result = await promise;
      expect(result?.selectedIndex).toBe(1);
      expect(result?.element.id).toBe('fallback');
    } finally {
      jest.useRealTimers();
    }
  });
});
