/**
 * Tests for the e2e target resolver. Covers tier → target mapping and the two
 * skip reasons, including the forward-looking cloud-on-cloud skip that the
 * cloud-auth follow-on will turn into a runnable target.
 */

import { resolveTarget } from './e2e-targets';

const LOCAL_URL = 'http://localhost:3000';

describe('resolveTarget', () => {
  it('runs local-tier guides against the configured Grafana URL', () => {
    const target = resolveTarget({ tier: 'local' }, { grafanaUrl: LOCAL_URL, currentTier: 'local' });

    expect(target.runnable).toBe(true);
    expect(target.grafanaUrl).toBe(LOCAL_URL);
    expect(target.tier).toBe('local');
    expect(target.skipReason).toBeUndefined();
  });

  it('treats a missing tier as local (runnable)', () => {
    const target = resolveTarget({}, { grafanaUrl: LOCAL_URL, currentTier: 'local' });

    expect(target.runnable).toBe(true);
    expect(target.tier).toBe('local');
    expect(target.grafanaUrl).toBe(LOCAL_URL);
  });

  it('runs an unknown tier (forward-compatible) against the configured URL', () => {
    const target = resolveTarget({ tier: 'enterprise' }, { grafanaUrl: LOCAL_URL, currentTier: 'local' });

    expect(target.runnable).toBe(true);
    expect(target.tier).toBe('enterprise');
    expect(target.grafanaUrl).toBe(LOCAL_URL);
  });

  it('skips a cloud guide on a local environment with tier-mismatch', () => {
    const target = resolveTarget({ tier: 'cloud' }, { grafanaUrl: LOCAL_URL, currentTier: 'local' });

    expect(target.runnable).toBe(false);
    expect(target.skipReason).toBe('skipped_tier_mismatch');
    expect(target.grafanaUrl).toBeUndefined();
    expect(target.message).toBeDefined();
  });

  it('skips a cloud guide on a cloud environment with no-auth (credentials deferred)', () => {
    const target = resolveTarget({ tier: 'cloud' }, { grafanaUrl: LOCAL_URL, currentTier: 'cloud' });

    expect(target.runnable).toBe(false);
    expect(target.skipReason).toBe('skipped_no_auth');
  });

  it('carries the requested instance through on both run and skip', () => {
    const runnable = resolveTarget(
      { tier: 'local', instance: 'play.grafana.org' },
      { grafanaUrl: LOCAL_URL, currentTier: 'local' }
    );
    expect(runnable.instance).toBe('play.grafana.org');

    const skipped = resolveTarget(
      { tier: 'cloud', instance: 'myslug.grafana.net' },
      { grafanaUrl: LOCAL_URL, currentTier: 'local' }
    );
    expect(skipped.instance).toBe('myslug.grafana.net');
  });
});
