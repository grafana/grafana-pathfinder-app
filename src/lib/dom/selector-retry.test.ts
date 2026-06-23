import { describe, it, expect, beforeEach } from '@jest/globals';
import { resolveWithRetry } from './selector-retry';

describe('resolveWithRetry', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('resolves a single string and reports selectedIndex 0', async () => {
    document.body.innerHTML = '<div id="a"></div>';
    const resolved = await resolveWithRetry('#a', 'highlight', { delays: [] });
    expect(resolved?.element.id).toBe('a');
    expect(resolved?.selectedIndex).toBe(0);
    expect(resolved?.usedFallback).toBe(false);
  });

  it('falls back to a later selector and surfaces selectedIndex', async () => {
    document.body.innerHTML = '<div id="fallback"></div>';
    const resolved = await resolveWithRetry(['#missing', '#fallback'], 'highlight', { delays: [] });
    expect(resolved?.element.id).toBe('fallback');
    expect(resolved?.selectedIndex).toBe(1);
  });

  it('returns null when nothing matches', async () => {
    const resolved = await resolveWithRetry(['#x', '#y'], 'highlight', { delays: [] });
    expect(resolved).toBeNull();
  });
});
