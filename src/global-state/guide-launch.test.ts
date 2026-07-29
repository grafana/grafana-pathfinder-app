import { guideLaunchStore, type StagedLaunchPayload } from './guide-launch';
import type { RawContent } from '../types/content.types';

const rawContent: RawContent = {
  content: '{"id":"g","title":"g","blocks":[]}',
  metadata: { title: 'g' },
  type: 'interactive',
  url: 'bundled:first-dashboard',
  lastFetched: '2026-07-28T00:00:00.000Z',
};

function payload(overrides: Partial<StagedLaunchPayload> = {}): StagedLaunchPayload {
  return { url: 'bundled:first-dashboard', preparedContent: rawContent, ...overrides };
}

describe('guideLaunchStore', () => {
  it('redeems a staged payload exactly once for the URL it was staged for', () => {
    const key = guideLaunchStore.stage(payload());

    expect(guideLaunchStore.consume(key, 'bundled:first-dashboard')).toEqual(payload());
    // Consume-once: a replayed key gets nothing.
    expect(guideLaunchStore.consume(key, 'bundled:first-dashboard')).toBeNull();
  });

  it('returns null for a forged or absent key (caller falls back to a normal fetch)', () => {
    guideLaunchStore.stage(payload());

    expect(guideLaunchStore.consume('not-a-real-key', 'bundled:first-dashboard')).toBeNull();
    expect(guideLaunchStore.consume(undefined, 'bundled:first-dashboard')).toBeNull();
  });

  it('refuses to redeem a genuine key against a different URL', () => {
    // A same-page script that observed a real key must not be able to attach
    // it to attacker-chosen content coordinates.
    const key = guideLaunchStore.stage(payload());

    expect(guideLaunchStore.consume(key, 'https://evil.example/content.json')).toBeNull();
    // The mismatch also burns the key — no second try at the right URL.
    expect(guideLaunchStore.consume(key, 'bundled:first-dashboard')).toBeNull();
  });

  it('treats entries older than the redemption deadline as abandoned', () => {
    const now = Date.now();
    const nowSpy = jest.spyOn(Date, 'now');

    nowSpy.mockReturnValue(now);
    const key = guideLaunchStore.stage(payload());

    nowSpy.mockReturnValue(now + 61_000);
    expect(guideLaunchStore.consume(key, 'bundled:first-dashboard')).toBeNull();

    nowSpy.mockRestore();
  });

  it('sweeps expired entries on stage so abandoned launches do not accumulate', () => {
    // Redemption is the only other eviction path, and an abandoned launch's
    // key is exactly the one that is never redeemed — the sweep keeps memory
    // bounded by construction instead of by the redeemer's good behaviour.
    const now = Date.now();
    const nowSpy = jest.spyOn(Date, 'now');
    const staged = (guideLaunchStore as unknown as { _staged: Map<string, unknown> })._staged;

    nowSpy.mockReturnValue(now);
    guideLaunchStore.stage(payload());

    nowSpy.mockReturnValue(now + 61_000);
    const freshKey = guideLaunchStore.stage(payload());

    // Everything staged before the deadline (including leftovers from other
    // tests) is expired at this point — only the fresh entry survives.
    expect(staged.size).toBe(1);
    guideLaunchStore.consume(freshKey, 'bundled:first-dashboard');
    nowSpy.mockRestore();
  });

  it('issues unguessable, non-repeating keys', () => {
    const first = guideLaunchStore.stage(payload());
    const second = guideLaunchStore.stage(payload());

    expect(first).not.toEqual(second);
    // UUID shape — the key must not be derivable from the payload.
    expect(first).toMatch(/^[0-9a-f-]{36}$/);

    // Drain what this test staged.
    guideLaunchStore.consume(first, 'bundled:first-dashboard');
    guideLaunchStore.consume(second, 'bundled:first-dashboard');
  });
});
