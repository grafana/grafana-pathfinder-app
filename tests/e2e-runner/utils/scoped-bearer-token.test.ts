import { scopedBearerHeaders } from '../auth/scoped-bearer-token';

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
