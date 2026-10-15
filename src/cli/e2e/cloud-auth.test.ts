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

  it('throws when an admin token mapping references an unset env var', () => {
    expect(() =>
      createCloudAuthPolicy({
        cloudInstanceAdminTokenSpecs: ['play.grafana.org=GRAFANA_PLAY_ADMIN_TOKEN'],
        env: {},
      })
    ).toThrow(/GRAFANA_PLAY_ADMIN_TOKEN/);
  });
});

describe('named-target mutation authorization', () => {
  const credentials = ['docs.example=DOCS_TOKEN', 'play.grafana.org=PLAY_TOKEN'];
  const env = { DOCS_TOKEN: 'docs-admin', PLAY_TOKEN: 'play-admin' };

  it('does not treat administrator credentials as mutation permission', () => {
    const auth = createCloudAuthPolicy({ cloudInstanceAdminTokenSpecs: credentials, env });
    expect(auth.allowsMutationsFor('https://docs.example/')).toBe(false);
    expect(auth.allowsMutationsFor(undefined)).toBe(false);
  });

  it('normalizes hostnames while keeping multiple credentials and permissions independently scoped', () => {
    const auth = createCloudAuthPolicy({
      cloudInstanceAdminTokenSpecs: credentials,
      allowCloudInstanceMutations: ['DOCS.EXAMPLE'],
      env,
    });
    expect(auth.adminTokenFor('https://play.grafana.org/')).toBe('play-admin');
    expect(auth.adminTokenFor('https://docs.example/')).toBe('docs-admin');
    expect(auth.allowsMutationsFor('https://docs.example/path')).toBe(true);
    for (const target of [
      'https://play.grafana.org/',
      'http://docs.example/',
      'https://docs.example:3000/',
      'https://sub.docs.example/',
      'invalid',
    ]) {
      expect(auth.allowsMutationsFor(target)).toBe(false);
    }
    const both = createCloudAuthPolicy({
      cloudInstanceAdminTokenSpecs: credentials,
      allowCloudInstanceMutations: ['docs.example', 'play.grafana.org'],
      env,
    });
    expect(both.allowsMutationsFor('https://play.grafana.org/')).toBe(true);
    expect(both.allowsMutationsFor('https://docs.example/')).toBe(true);
  });

  it.each([
    '',
    'https://docs.example',
    'docs.example/path',
    'docs.example:443',
    'docs.example=DOCS_TOKEN',
    ' docs.example',
    '*.example',
    'true',
  ])('rejects malformed permission %j', (host) => {
    expect(() =>
      createCloudAuthPolicy({ cloudInstanceAdminTokenSpecs: credentials, allowCloudInstanceMutations: [host], env })
    ).toThrow(/--allow-cloud-instance-mutations/);
  });

  it('rejects duplicates after normalization', () => {
    expect(() =>
      createCloudAuthPolicy({
        cloudInstanceAdminTokenSpecs: credentials,
        allowCloudInstanceMutations: ['docs.example', 'DOCS.EXAMPLE'],
        env,
      })
    ).toThrow(/Duplicate/);
  });

  it.each([{ specs: [] }, { specs: ['play.grafana.org=PLAY_TOKEN'] }])(
    'requires exact-host authentication: %j',
    ({ specs }) => {
      expect(() =>
        createCloudAuthPolicy({
          cloudInstanceAdminTokenSpecs: specs,
          allowCloudInstanceMutations: ['docs.example'],
          env,
        })
      ).toThrow(/requires matching/);
    }
  );
});
