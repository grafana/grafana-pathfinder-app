let mockVersionString = 'Grafana Cloud';
let mockUser = {
  analytics: { identifier: 'user-123' },
  email: 'person@example.com',
  orgRole: 'Editor',
  orgName: 'Acme Corp',
};

jest.mock('@grafana/runtime', () => ({
  get config() {
    return {
      bootData: {
        settings: { buildInfo: { versionString: mockVersionString } },
        user: mockUser,
      },
    };
  },
}));

import { buildTelemetryIdentity } from './identity';

describe('buildTelemetryIdentity', () => {
  beforeEach(() => {
    mockVersionString = 'Grafana Cloud';
    mockUser = {
      analytics: { identifier: 'user-123' },
      email: 'person@example.com',
      orgRole: 'Editor',
      orgName: 'Acme Corp',
    };
  });

  it('gives Faro the raw id/email while the recommender keeps a SHA-256 hash pair', async () => {
    const identity = await buildTelemetryIdentity();

    expect(identity.userId).toBe('user-123');
    expect(identity.email).toBe('person@example.com');
    expect(identity.hasEmail).toBe(true);
    expect(identity.orgRole).toBe('Editor');
    expect(identity.orgName).toBe('Acme Corp');
    expect(identity.userIdHash).toMatch(/^[0-9a-f]{64}$/);
    expect(identity.emailHash).toMatch(/^[0-9a-f]{64}$/);
    expect(identity.userIdHash).not.toBe(identity.userId);
    expect(identity.emailHash).not.toBe(identity.email);
  });

  it('falls back to a stable oss identity off Cloud', async () => {
    mockVersionString = 'Grafana v11.0.0';

    const identity = await buildTelemetryIdentity();

    expect(identity.isCloud).toBe(false);
    expect(identity.userId).toBe('oss-user');
    expect(identity.email).toBe('');
    expect(identity.hasEmail).toBe(false);
  });

  it('email-less Cloud users get an empty raw email without collapsing the recommender hash pair', async () => {
    mockUser.email = '';

    const identity = await buildTelemetryIdentity();

    expect(identity.hasEmail).toBe(false);
    expect(identity.email).toBe('');
    expect(identity.userId).toBe('user-123');
    expect(identity.userIdHash).not.toBe(identity.emailHash);
  });

  it('gives two different email-less Cloud users distinct recommender emailHash values', async () => {
    mockUser.email = '';
    mockUser.analytics = { identifier: 'user-123' };
    const first = await buildTelemetryIdentity();

    mockUser.email = '';
    mockUser.analytics = { identifier: 'user-456' };
    const second = await buildTelemetryIdentity();

    expect(first.emailHash).not.toBe(second.emailHash);
  });
});
