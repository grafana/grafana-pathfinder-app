import { createInitialDodgeSession, dodgeSessionReducer, type DodgeSessionState } from './dodge-session';

describe('dodgeSessionReducer', () => {
  let initial: DodgeSessionState;

  beforeEach(() => {
    initial = createInitialDodgeSession();
  });

  describe('COMPACT', () => {
    it('adopts the measured scrollTop when no session scroll is saved', () => {
      const state = dodgeSessionReducer(initial, { type: 'COMPACT', measuredScrollTop: 800 });

      expect(state.view).toBe('compact');
      expect(state.savedScrollTop).toBe(800);
      expect(state.restoreToken).toBe(initial.restoreToken + 1);
    });

    it('does not overwrite an existing savedScrollTop with a layout-derived read', () => {
      const compacted = dodgeSessionReducer(initial, { type: 'COMPACT', measuredScrollTop: 800 });
      const restored = dodgeSessionReducer(compacted, { type: 'RESTORE_FULL' });

      // Compact mode clamps the scroll container to 0 before the deferred
      // restore lands; that 0 must not become authoritative.
      const recompacted = dodgeSessionReducer(restored, { type: 'COMPACT', measuredScrollTop: 0 });

      expect(recompacted.savedScrollTop).toBe(800);
    });

    it('invalidates a scheduled scroll restore', () => {
      const compacted = dodgeSessionReducer(initial, { type: 'COMPACT', measuredScrollTop: 800 });
      const scheduled = dodgeSessionReducer(compacted, { type: 'RESTORE_FULL' });
      const recompacted = dodgeSessionReducer(scheduled, { type: 'COMPACT', measuredScrollTop: 0 });

      expect(recompacted.restoreToken).toBe(scheduled.restoreToken + 1);
      expect(dodgeSessionReducer(recompacted, { type: 'SCROLL_RESTORE_LANDED', token: scheduled.restoreToken })).toBe(
        recompacted
      );
    });
  });

  describe('RESTORE_FULL', () => {
    it('with saved scroll schedules a restore under a fresh token', () => {
      const compacted = dodgeSessionReducer(initial, { type: 'COMPACT', measuredScrollTop: 800 });
      const state = dodgeSessionReducer(compacted, { type: 'RESTORE_FULL' });

      expect(state.view).toBe('full');
      expect(state.savedScrollTop).toBe(800);
      expect(state.restoreToken).toBe(compacted.restoreToken + 1);
    });

    it('without saved scroll returns to full without a token bump', () => {
      const compacted = dodgeSessionReducer(initial, { type: 'COMPACT', measuredScrollTop: null });
      const state = dodgeSessionReducer(compacted, { type: 'RESTORE_FULL' });

      expect(state.view).toBe('full');
      expect(state.restoreToken).toBe(compacted.restoreToken);
    });

    it('is a reference-equal no-op when already full with nothing saved', () => {
      expect(dodgeSessionReducer(initial, { type: 'RESTORE_FULL' })).toBe(initial);
    });

    it('a second RESTORE_FULL supersedes the first schedule', () => {
      const compacted = dodgeSessionReducer(initial, { type: 'COMPACT', measuredScrollTop: 800 });
      const first = dodgeSessionReducer(compacted, { type: 'RESTORE_FULL' });
      const second = dodgeSessionReducer(first, { type: 'RESTORE_FULL' });

      expect(second.restoreToken).toBe(first.restoreToken + 1);
      expect(dodgeSessionReducer(second, { type: 'SCROLL_RESTORE_LANDED', token: first.restoreToken })).toBe(second);

      const landed = dodgeSessionReducer(second, { type: 'SCROLL_RESTORE_LANDED', token: second.restoreToken });
      expect(landed.savedScrollTop).toBeNull();
    });

    it('never carries position state', () => {
      const compacted = dodgeSessionReducer(initial, { type: 'COMPACT', measuredScrollTop: 800 });
      const state = dodgeSessionReducer(compacted, { type: 'RESTORE_FULL' });

      expect(Object.keys(state).sort()).toEqual(['restoreToken', 'savedScrollTop', 'view']);
    });
  });

  describe('MINIMIZE', () => {
    it('adopts the measured scrollTop when no session scroll is saved', () => {
      // Minimize hides the panel with display:none, which clamps the scroll
      // container to 0 — the pre-minimize measurement is the only
      // authoritative value left for the pill restore.
      const state = dodgeSessionReducer(initial, { type: 'MINIMIZE', measuredScrollTop: 800 });

      expect(state.view).toBe('minimized');
      expect(state.savedScrollTop).toBe(800);
      expect(state.restoreToken).toBe(initial.restoreToken + 1);
    });

    it('preserves savedScrollTop over a layout-derived read and invalidates any scheduled restore', () => {
      const compacted = dodgeSessionReducer(initial, { type: 'COMPACT', measuredScrollTop: 800 });
      const scheduled = dodgeSessionReducer(compacted, { type: 'RESTORE_FULL' });
      const minimized = dodgeSessionReducer(scheduled, { type: 'MINIMIZE', measuredScrollTop: 0 });

      expect(minimized.view).toBe('minimized');
      expect(minimized.savedScrollTop).toBe(800);
      expect(minimized.restoreToken).toBe(scheduled.restoreToken + 1);
      expect(dodgeSessionReducer(minimized, { type: 'SCROLL_RESTORE_LANDED', token: scheduled.restoreToken })).toBe(
        minimized
      );
    });

    it('then RESTORE_FULL schedules the preserved scroll (pill restore)', () => {
      const compacted = dodgeSessionReducer(initial, { type: 'COMPACT', measuredScrollTop: 800 });
      const minimized = dodgeSessionReducer(compacted, { type: 'MINIMIZE', measuredScrollTop: 0 });
      const restored = dodgeSessionReducer(minimized, { type: 'RESTORE_FULL' });

      expect(restored.view).toBe('full');
      expect(restored.savedScrollTop).toBe(800);
      expect(restored.restoreToken).toBe(minimized.restoreToken + 1);
    });

    it('then RESTORE_FULL schedules the scroll measured at minimize time', () => {
      const minimized = dodgeSessionReducer(initial, { type: 'MINIMIZE', measuredScrollTop: 800 });
      const restored = dodgeSessionReducer(minimized, { type: 'RESTORE_FULL' });

      expect(restored.view).toBe('full');
      expect(restored.savedScrollTop).toBe(800);
      expect(restored.restoreToken).toBe(minimized.restoreToken + 1);
    });
  });

  describe('SCROLL_RESTORE_LANDED', () => {
    it('with the current token clears the saved scroll', () => {
      const compacted = dodgeSessionReducer(initial, { type: 'COMPACT', measuredScrollTop: 800 });
      const scheduled = dodgeSessionReducer(compacted, { type: 'RESTORE_FULL' });
      const landed = dodgeSessionReducer(scheduled, { type: 'SCROLL_RESTORE_LANDED', token: scheduled.restoreToken });

      expect(landed.savedScrollTop).toBeNull();
      expect(landed.view).toBe('full');
    });

    it('with a stale token is a no-op', () => {
      const compacted = dodgeSessionReducer(initial, { type: 'COMPACT', measuredScrollTop: 800 });
      const scheduled = dodgeSessionReducer(compacted, { type: 'RESTORE_FULL' });
      const state = dodgeSessionReducer(scheduled, {
        type: 'SCROLL_RESTORE_LANDED',
        token: scheduled.restoreToken - 1,
      });

      expect(state).toBe(scheduled);
    });

    it('with nothing saved is a no-op even with a matching token', () => {
      const state = dodgeSessionReducer(initial, { type: 'SCROLL_RESTORE_LANDED', token: initial.restoreToken });

      expect(state).toBe(initial);
    });
  });

  it('returns state unchanged for unknown actions', () => {
    const unknown = { type: 'UNKNOWN' } as never;
    expect(dodgeSessionReducer(initial, unknown)).toBe(initial);
  });
});
