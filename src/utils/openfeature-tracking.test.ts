/**
 * Tests for openfeature-tracking
 *
 * Verifies that TrackingHook fires exposure events exactly once per
 * (hostname, flag, variant) tuple across page loads, with the in-memory Set
 * acting as a same-session fast path.
 */

const mockReportAppInteraction = jest.fn();
jest.mock('../lib/analytics', () => ({
  reportAppInteraction: (...args: unknown[]) => mockReportAppInteraction(...args),
  UserInteraction: {
    FeatureFlagEvaluated: 'feature_flag_evaluated',
  },
}));

jest.mock('../lib/storage-keys', () => ({
  StorageKeys: {
    EXPERIMENT_EXPOSURE_REPORTED_PREFIX: 'grafana-pathfinder-experiment-exposure-reported-',
  },
}));

jest.mock('./openfeature', () => ({
  pathfinderFeatureFlags: {
    'pathfinder.enabled': {
      valueType: 'boolean',
      defaultValue: true,
      trackingKey: 'pathfinder_enabled',
    },
    'pathfinder.highlighted-guide-experiment': {
      valueType: 'object',
      defaultValue: { variant: 'excluded' },
      trackingKey: 'highlighted_guide_experiment',
    },
    'pathfinder.no-tracking-key': {
      valueType: 'object',
      defaultValue: { variant: 'excluded' },
    },
  },
}));

import type { EvaluationDetails, HookContext, JsonValue } from '@openfeature/web-sdk';

// Hostname comes from `window.location.hostname` (jsdom's default in this env).
// We don't try to mutate it per-test — the marker key construction is verified by
// inspection (string format includes hostname), and the cross-hostname isolation
// follows from that.

function freshHook() {
  jest.resetModules();
  // Importing fresh resets the in-memory `reportedFlagsThisPageLoad` Set.
  const { TrackingHook } = require('./openfeature-tracking');
  return new TrackingHook();
}

function freshReportFn() {
  jest.resetModules();
  const { reportFeatureFlagExposure } = require('./openfeature-tracking');
  return reportFeatureFlagExposure as (flagKey: string, value: JsonValue) => void;
}

function ctx(flagKey: string): HookContext {
  return { flagKey } as unknown as HookContext;
}

function details(value: JsonValue): EvaluationDetails<JsonValue> {
  return { value } as unknown as EvaluationDetails<JsonValue>;
}

describe('TrackingHook.after', () => {
  beforeEach(() => {
    localStorage.clear();
    mockReportAppInteraction.mockClear();
  });

  it('fires exposure for a treatment variant on first evaluation', () => {
    const hook = freshHook();
    hook.after(
      ctx('pathfinder.highlighted-guide-experiment'),
      details({ variant: 'treatment', pages: [], guideId: '' })
    );
    expect(mockReportAppInteraction).toHaveBeenCalledTimes(1);
    expect(mockReportAppInteraction).toHaveBeenCalledWith('feature_flag_evaluated', {
      flag_key: 'pathfinder.highlighted-guide-experiment',
      flag_value: JSON.stringify({ variant: 'treatment', pages: [], guideId: '' }),
      tracking_key: 'highlighted_guide_experiment',
      variant: 'treatment',
    });
  });

  it('writes a localStorage marker after firing so a fresh module instance does not re-fire', () => {
    let hook = freshHook();
    hook.after(ctx('pathfinder.highlighted-guide-experiment'), details({ variant: 'treatment' }));
    expect(mockReportAppInteraction).toHaveBeenCalledTimes(1);

    // Simulate a page reload (fresh module → fresh in-memory Set, persistent marker stays).
    hook = freshHook();
    hook.after(ctx('pathfinder.highlighted-guide-experiment'), details({ variant: 'treatment' }));
    expect(mockReportAppInteraction).toHaveBeenCalledTimes(1);
  });

  it('does not fire twice within a single page load even for repeated evaluations', () => {
    const hook = freshHook();
    hook.after(ctx('pathfinder.highlighted-guide-experiment'), details({ variant: 'treatment' }));
    hook.after(ctx('pathfinder.highlighted-guide-experiment'), details({ variant: 'treatment' }));
    hook.after(ctx('pathfinder.highlighted-guide-experiment'), details({ variant: 'treatment' }));
    expect(mockReportAppInteraction).toHaveBeenCalledTimes(1);
  });

  it('re-fires when the user is reassigned to a different variant for the same flag', () => {
    let hook = freshHook();
    hook.after(ctx('pathfinder.highlighted-guide-experiment'), details({ variant: 'control' }));
    expect(mockReportAppInteraction).toHaveBeenCalledTimes(1);

    // Next page load, MTFF rerolls and assigns this user to treatment.
    hook = freshHook();
    hook.after(ctx('pathfinder.highlighted-guide-experiment'), details({ variant: 'treatment' }));
    expect(mockReportAppInteraction).toHaveBeenCalledTimes(2);
    expect(mockReportAppInteraction.mock.calls[1]?.[1].variant).toBe('treatment');
  });

  it('writes the marker under a key that includes the hostname (cross-stack isolation)', () => {
    const hook = freshHook();
    hook.after(ctx('pathfinder.highlighted-guide-experiment'), details({ variant: 'treatment' }));
    const writtenKey = Object.keys(localStorage).find((k) =>
      k.startsWith('grafana-pathfinder-experiment-exposure-reported-')
    );
    // Marker has shape `{prefix}{hostname}:{flag}:{variant}` — confirm the hostname segment is present
    // so two stacks on the same browser get independent dedup markers.
    expect(writtenKey).toMatch(
      /grafana-pathfinder-experiment-exposure-reported-.+:pathfinder\.highlighted-guide-experiment:treatment$/
    );
  });

  it('skips excluded variants entirely', () => {
    const hook = freshHook();
    hook.after(ctx('pathfinder.highlighted-guide-experiment'), details({ variant: 'excluded' }));
    expect(mockReportAppInteraction).not.toHaveBeenCalled();
    // No marker written either — re-evaluation on a future arm reassignment should fire.
    expect(localStorage.length).toBe(0);
  });

  it('skips boolean flags', () => {
    const hook = freshHook();
    hook.after(ctx('pathfinder.enabled'), details(true));
    expect(mockReportAppInteraction).not.toHaveBeenCalled();
  });

  it('skips object flags that have no trackingKey', () => {
    const hook = freshHook();
    hook.after(ctx('pathfinder.no-tracking-key'), details({ variant: 'treatment' }));
    expect(mockReportAppInteraction).not.toHaveBeenCalled();
  });

  it('skips flags from other plugins (non-pathfinder prefix)', () => {
    const hook = freshHook();
    hook.after(ctx('grafana.some-flag'), details({ variant: 'treatment' }));
    expect(mockReportAppInteraction).not.toHaveBeenCalled();
  });
});

describe('reportFeatureFlagExposure', () => {
  // Exercises the standalone helper that both `TrackingHook.after` and the
  // local-override short-circuit in openfeature.ts call. Covers the same
  // filtering + dedup semantics as the hook tests above, but invoked directly.

  beforeEach(() => {
    localStorage.clear();
    mockReportAppInteraction.mockClear();
  });

  it('fires exposure for a treatment variant on first call', () => {
    const report = freshReportFn();
    report('pathfinder.highlighted-guide-experiment', {
      variant: 'treatment',
      pages: [],
      guideId: '',
    });
    expect(mockReportAppInteraction).toHaveBeenCalledTimes(1);
    expect(mockReportAppInteraction).toHaveBeenCalledWith('feature_flag_evaluated', {
      flag_key: 'pathfinder.highlighted-guide-experiment',
      flag_value: JSON.stringify({ variant: 'treatment', pages: [], guideId: '' }),
      tracking_key: 'highlighted_guide_experiment',
      variant: 'treatment',
    });
  });

  it('persists a marker so a fresh module instance does not re-fire', () => {
    let report = freshReportFn();
    report('pathfinder.highlighted-guide-experiment', { variant: 'treatment', pages: [] });
    expect(mockReportAppInteraction).toHaveBeenCalledTimes(1);

    report = freshReportFn();
    report('pathfinder.highlighted-guide-experiment', { variant: 'treatment', pages: [] });
    expect(mockReportAppInteraction).toHaveBeenCalledTimes(1);
  });

  it('dedups within a single page load even across repeated calls', () => {
    const report = freshReportFn();
    report('pathfinder.highlighted-guide-experiment', { variant: 'treatment', pages: [] });
    report('pathfinder.highlighted-guide-experiment', { variant: 'treatment', pages: [] });
    report('pathfinder.highlighted-guide-experiment', { variant: 'treatment', pages: [] });
    expect(mockReportAppInteraction).toHaveBeenCalledTimes(1);
  });

  it('re-fires when the variant for the same flag changes', () => {
    let report = freshReportFn();
    report('pathfinder.highlighted-guide-experiment', { variant: 'control' });
    expect(mockReportAppInteraction).toHaveBeenCalledTimes(1);

    report = freshReportFn();
    report('pathfinder.highlighted-guide-experiment', { variant: 'treatment' });
    expect(mockReportAppInteraction).toHaveBeenCalledTimes(2);
    expect(mockReportAppInteraction.mock.calls[1]?.[1].variant).toBe('treatment');
  });

  it('skips excluded variants', () => {
    const report = freshReportFn();
    report('pathfinder.highlighted-guide-experiment', { variant: 'excluded', pages: [] });
    expect(mockReportAppInteraction).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it('skips boolean flags (config, not experiment arms)', () => {
    const report = freshReportFn();
    report('pathfinder.enabled', true);
    expect(mockReportAppInteraction).not.toHaveBeenCalled();
  });

  it('skips object flags without a trackingKey', () => {
    const report = freshReportFn();
    report('pathfinder.no-tracking-key', { variant: 'treatment' });
    expect(mockReportAppInteraction).not.toHaveBeenCalled();
  });

  it('skips unknown / non-pathfinder flag keys', () => {
    const report = freshReportFn();
    report('grafana.some-flag', { variant: 'treatment' });
    report('pathfinder.does-not-exist', { variant: 'treatment' });
    expect(mockReportAppInteraction).not.toHaveBeenCalled();
  });
});
