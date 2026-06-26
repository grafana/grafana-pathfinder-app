import { createCloudAuthPolicy } from './cloud-auth';

const CLOUD_URL = 'https://learn.grafana.net/';

describe('createCloudAuthPolicy', () => {
  it('scopes default reusable credentials to the configured cloud URL', () => {
    const auth = createCloudAuthPolicy({
      cloudUrl: CLOUD_URL,
      serviceAccountToken: 'glsa_default',
      env: {},
    });

    expect(auth.targets).toEqual({
      reusable: [CLOUD_URL],
      provisionable: undefined,
    });
    expect(auth.runnerAuthFor(CLOUD_URL)).toEqual({ token: 'glsa_default' });
    expect(auth.runnerAuthFor('https://play.grafana.org/')).toEqual({ token: undefined });
  });

  it('resolves instance tokens from env vars and scopes them to their hosts', () => {
    const auth = createCloudAuthPolicy({
      cloudUrl: CLOUD_URL,
      instanceTokenSpecs: ['play.grafana.org=GRAFANA_PLAY_TOKEN'],
      env: { GRAFANA_PLAY_TOKEN: 'glsa_play' },
    });

    expect(auth.targets).toEqual({
      reusable: ['https://play.grafana.org/'],
      provisionable: undefined,
    });
    expect(auth.runnerAuthFor('https://play.grafana.org/')).toEqual({ token: 'glsa_play' });
    expect(auth.runnerAuthFor(CLOUD_URL)).toEqual({ token: undefined });
  });

  it('prefers a provisioned token for the configured cloud URL', () => {
    const auth = createCloudAuthPolicy({
      cloudUrl: CLOUD_URL,
      serviceAccountToken: 'glsa_static',
      cloudAdminToken: 'glsa_admin',
      env: {},
    });

    expect(auth.targets).toEqual({
      reusable: [CLOUD_URL],
      provisionable: CLOUD_URL,
    });
    expect(auth.needsProvisioningFor(CLOUD_URL)).toBe(true);
    expect(auth.needsProvisioningFor('https://play.grafana.org/')).toBe(false);
    expect(auth.runnerAuthFor(CLOUD_URL, 'glsa_provisioned')).toEqual({ token: 'glsa_provisioned' });
  });

  it('throws when an instance token references an unset env var', () => {
    expect(() =>
      createCloudAuthPolicy({
        cloudUrl: CLOUD_URL,
        instanceTokenSpecs: ['play.grafana.org=GRAFANA_PLAY_TOKEN'],
        env: {},
      })
    ).toThrow(/GRAFANA_PLAY_TOKEN/);
  });
});
