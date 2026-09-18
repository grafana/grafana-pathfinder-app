import { createScopedBearerTokenAuthStrategy, scopedBearerHeaders } from '../auth/scoped-bearer-token';

const TARGET_URL = 'https://learn.grafana.net/';
const SERVICE_ACCOUNT_SHAPED_TOKEN = 'glsa_minted';
const JWT_SHAPED_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJydW5uZXIifQ.signature';

describe.each([
  ['service-account-shaped', SERVICE_ACCOUNT_SHAPED_TOKEN],
  ['JWT-shaped', JWT_SHAPED_TOKEN],
] as const)('scopedBearerHeaders with a %s credential', (_credentialShape, token) => {
  it('returns Authorization for requests to the target origin', () => {
    expect(scopedBearerHeaders('https://learn.grafana.net/api/user', TARGET_URL, token)).toEqual({
      Authorization: `Bearer ${token}`,
    });
  });

  it('does not return Authorization for requests to another origin', () => {
    expect(scopedBearerHeaders('https://example.com/api/user', TARGET_URL, token)).toBeUndefined();
  });

  it('resolves relative URLs against the target origin', () => {
    expect(scopedBearerHeaders('/api/user', TARGET_URL, token)).toEqual({
      Authorization: `Bearer ${token}`,
    });
  });
});

describe('scoped bearer session classification', () => {
  it.each([
    [401, 'auth_expired'],
    [403, 'auth_expired'],
    [500, 'infrastructure_error'],
  ] as const)('classifies HTTP %s as %s', async (status, failureKind) => {
    const strategy = createScopedBearerTokenAuthStrategy(SERVICE_ACCOUNT_SHAPED_TOKEN, TARGET_URL);
    const page = {
      request: {
        get: jest.fn().mockResolvedValue({
          ok: jest.fn(() => false),
          status: jest.fn(() => status),
        }),
      },
    };

    await expect(strategy.validateSession(page as never)).resolves.toMatchObject({
      valid: false,
      failureKind,
    });
  });

  it('classifies request transport errors as infrastructure loss', async () => {
    const strategy = createScopedBearerTokenAuthStrategy(SERVICE_ACCOUNT_SHAPED_TOKEN, TARGET_URL);
    const page = {
      request: {
        get: jest.fn().mockRejectedValue(new Error('Connection reset')),
      },
    };

    await expect(strategy.validateSession(page as never)).resolves.toMatchObject({
      valid: false,
      failureKind: 'infrastructure_error',
    });
  });
});
