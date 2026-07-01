/**
 * Tests for the e2e target resolver. Covers tier → target mapping, skip
 * reasons, and cloud execution capabilities.
 */

import { resolveTarget } from './e2e-targets';

const LOCAL_URL = 'http://localhost:3000';
const CLOUD_URL = 'https://learn.grafana.net/';

describe('resolveTarget', () => {
  it('runs local-tier guides against the configured Grafana URL', () => {
    const target = resolveTarget({ tier: 'local' }, { grafanaUrl: LOCAL_URL, currentTier: 'local' });

    expect(target.runnable).toBe(true);
    expect(target.targetUrl).toBe(LOCAL_URL);
    expect(target.tier).toBe('local');
    expect(target.skipReason).toBeUndefined();
  });

  it('treats a missing tier as local (runnable)', () => {
    const target = resolveTarget({}, { grafanaUrl: LOCAL_URL, currentTier: 'local' });

    expect(target.runnable).toBe(true);
    expect(target.tier).toBe('local');
    expect(target.targetUrl).toBe(LOCAL_URL);
  });

  it('runs an unknown tier (forward-compatible) against the configured URL', () => {
    const target = resolveTarget({ tier: 'enterprise' }, { grafanaUrl: LOCAL_URL, currentTier: 'local' });

    expect(target.runnable).toBe(true);
    expect(target.tier).toBe('enterprise');
    expect(target.targetUrl).toBe(LOCAL_URL);
  });

  it('skips a cloud guide on a local environment with tier-mismatch', () => {
    const target = resolveTarget({ tier: 'cloud' }, { grafanaUrl: LOCAL_URL, currentTier: 'local' });

    expect(target.runnable).toBe(false);
    expect(target.skipReason).toBe('skipped_tier_mismatch');
    expect(target.targetUrl).toBeUndefined();
    expect(target.message).toBeDefined();
  });

  it('skips a cloud guide on a cloud environment when no cloud execution capability is available', () => {
    const target = resolveTarget(
      { tier: 'cloud' },
      { grafanaUrl: LOCAL_URL, currentTier: 'cloud', cloudUrl: CLOUD_URL }
    );

    expect(target.runnable).toBe(false);
    expect(target.skipReason).toBe('skipped_no_auth');
  });

  it('runs a cloud guide when isolated stack provisioning is available without shared-stack auth', () => {
    const target = resolveTarget(
      { tier: 'cloud' },
      {
        grafanaUrl: LOCAL_URL,
        currentTier: 'cloud',
        cloudUrl: CLOUD_URL,
        cloudTargetCapabilities: { sharedStackUrls: [], isolatedStack: true },
      }
    );

    expect(target.runnable).toBe(true);
    expect(target.targetUrl).toBe(CLOUD_URL);
  });

  it('does not use isolated stack provisioning for a declared cloud instance', () => {
    const target = resolveTarget(
      { tier: 'cloud', instance: 'play.grafana.org' },
      {
        grafanaUrl: LOCAL_URL,
        currentTier: 'cloud',
        cloudUrl: CLOUD_URL,
        cloudTargetCapabilities: { sharedStackUrls: [CLOUD_URL], isolatedStack: true },
      }
    );
    expect(target.runnable).toBe(false);
    expect(target.skipReason).toBe('skipped_no_auth');
    expect(target.message).toContain('--cloud-instance-admin-token for https://play.grafana.org/');
  });

  it('runs a cloud guide with shared-stack auth against the default cloud URL when no instance is declared', () => {
    const target = resolveTarget(
      { tier: 'cloud' },
      {
        grafanaUrl: LOCAL_URL,
        currentTier: 'cloud',
        cloudUrl: CLOUD_URL,
        cloudTargetCapabilities: { sharedStackUrls: [CLOUD_URL] },
      }
    );

    expect(target.runnable).toBe(true);
    expect(target.tier).toBe('cloud');
    expect(target.targetUrl).toBe(CLOUD_URL);
    expect(target.skipReason).toBeUndefined();
  });

  it('runs a cloud guide against its declared host-only instance', () => {
    const target = resolveTarget(
      { tier: 'cloud', instance: 'play.grafana.org' },
      {
        grafanaUrl: LOCAL_URL,
        currentTier: 'cloud',
        cloudUrl: CLOUD_URL,
        cloudTargetCapabilities: { sharedStackUrls: ['https://play.grafana.org/'] },
      }
    );

    expect(target.runnable).toBe(true);
    expect(target.targetUrl).toBe('https://play.grafana.org/');
    expect(target.instance).toBe('play.grafana.org');
  });

  it('does not use default shared-stack auth for a different declared instance', () => {
    const target = resolveTarget(
      { tier: 'cloud', instance: 'play.grafana.org' },
      {
        grafanaUrl: LOCAL_URL,
        currentTier: 'cloud',
        cloudUrl: CLOUD_URL,
        cloudTargetCapabilities: { sharedStackUrls: [CLOUD_URL] },
      }
    );

    expect(target.runnable).toBe(false);
    expect(target.skipReason).toBe('skipped_no_auth');
  });

  it('runs a cloud guide against its declared instance when admin-token provisioning matches that origin', () => {
    const target = resolveTarget(
      { tier: 'cloud', instance: 'learn.grafana.net' },
      {
        grafanaUrl: LOCAL_URL,
        currentTier: 'cloud',
        cloudUrl: CLOUD_URL,
        cloudTargetCapabilities: { sharedStackUrls: [CLOUD_URL] },
      }
    );

    expect(target.runnable).toBe(true);
    expect(target.targetUrl).toBe('https://learn.grafana.net/');
  });

  it('skips a declared instance when only admin-token provisioning for another origin is available', () => {
    const target = resolveTarget(
      { tier: 'cloud', instance: 'play.grafana.org' },
      {
        grafanaUrl: LOCAL_URL,
        currentTier: 'cloud',
        cloudUrl: CLOUD_URL,
        cloudTargetCapabilities: { sharedStackUrls: [CLOUD_URL] },
      }
    );

    expect(target.runnable).toBe(false);
    expect(target.skipReason).toBe('skipped_no_auth');
    expect(target.message).toContain('--cloud-instance-admin-token for https://play.grafana.org/');
  });

  it('skips a cloud guide whose instance is not a bare hostname with invalid-instance', () => {
    const target = resolveTarget(
      { tier: 'cloud', instance: 'https://play.grafana.org/path' },
      {
        grafanaUrl: LOCAL_URL,
        currentTier: 'cloud',
        cloudUrl: CLOUD_URL,
        cloudTargetCapabilities: { sharedStackUrls: [CLOUD_URL] },
      }
    );

    expect(target.runnable).toBe(false);
    expect(target.skipReason).toBe('skipped_invalid_instance');
    expect(target.targetUrl).toBeUndefined();
  });

  it('skips a cloud guide whose instance has URL control characters with invalid-instance', () => {
    const target = resolveTarget(
      { tier: 'cloud', instance: 'play.grafana.org?redirect=evil.test' },
      {
        grafanaUrl: LOCAL_URL,
        currentTier: 'cloud',
        cloudUrl: CLOUD_URL,
        cloudTargetCapabilities: { sharedStackUrls: [CLOUD_URL] },
      }
    );

    expect(target.runnable).toBe(false);
    expect(target.skipReason).toBe('skipped_invalid_instance');
  });

  it('skips a cloud guide with target capabilities but no resolvable cloud URL', () => {
    const target = resolveTarget(
      { tier: 'cloud' },
      { grafanaUrl: LOCAL_URL, currentTier: 'cloud', cloudTargetCapabilities: { sharedStackUrls: [CLOUD_URL] } }
    );

    expect(target.runnable).toBe(false);
    expect(target.skipReason).toBe('skipped_tier_mismatch');
    expect(target.targetUrl).toBeUndefined();
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
