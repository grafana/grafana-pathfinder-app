import { createCloudAuthPolicy } from './cloud-auth';

const CLOUD_URL = 'https://learn.grafana.net/';

describe('createCloudAuthPolicy', () => {
  it('declares shared-stack URLs when an admin token mapping exists', () => {
    const auth = createCloudAuthPolicy({
      cloudInstanceAdminTokenSpecs: ['learn.grafana.net=GRAFANA_LEARN_ADMIN_TOKEN'],
      env: { GRAFANA_LEARN_ADMIN_TOKEN: 'glsa_admin' },
    });

    expect(auth.targets).toEqual({
      sharedStackUrls: [CLOUD_URL],
    });
    expect(auth.adminTokenFor(CLOUD_URL)).toBe('glsa_admin');
    expect(auth.needsProvisioningFor(CLOUD_URL)).toBe(true);
    expect(auth.runnerAuthFor(CLOUD_URL)).toEqual({});
  });

  it('resolves instance admin tokens from env vars and scopes them to their hosts', () => {
    const auth = createCloudAuthPolicy({
      cloudInstanceAdminTokenSpecs: ['play.grafana.org=GRAFANA_PLAY_ADMIN_TOKEN'],
      env: { GRAFANA_PLAY_ADMIN_TOKEN: 'glsa_play_admin' },
    });

    expect(auth.targets).toEqual({
      sharedStackUrls: ['https://play.grafana.org/'],
    });
    expect(auth.adminTokenFor('https://play.grafana.org/')).toBe('glsa_play_admin');
    expect(auth.adminTokenFor(CLOUD_URL)).toBeUndefined();
  });

  it('returns the provisioned token as runner auth for that target', () => {
    const auth = createCloudAuthPolicy({
      cloudInstanceAdminTokenSpecs: ['learn.grafana.net=GRAFANA_LEARN_ADMIN_TOKEN'],
      env: { GRAFANA_LEARN_ADMIN_TOKEN: 'glsa_admin' },
    });

    expect(auth.runnerAuthFor(CLOUD_URL, 'glsa_provisioned')).toEqual({ token: 'glsa_provisioned' });
    expect(auth.runnerAuthFor('https://play.grafana.org/', 'glsa_provisioned')).toEqual({});
  });

  it('throws when an admin token mapping references an unset env var', () => {
    expect(() =>
      createCloudAuthPolicy({
        cloudInstanceAdminTokenSpecs: ['play.grafana.org=GRAFANA_PLAY_ADMIN_TOKEN'],
        env: {},
      })
    ).toThrow(/GRAFANA_PLAY_ADMIN_TOKEN/);
  });
});
