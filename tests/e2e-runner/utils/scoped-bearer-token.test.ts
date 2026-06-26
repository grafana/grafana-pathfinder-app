import { scopedBearerHeaders } from '../auth/scoped-bearer-token';

const TARGET_URL = 'https://learn.grafana.net/';
const TOKEN = 'glsa_minted';

describe('scopedBearerHeaders', () => {
  it('returns Authorization for requests to the target origin', () => {
    expect(scopedBearerHeaders('https://learn.grafana.net/api/user', TARGET_URL, TOKEN)).toEqual({
      Authorization: `Bearer ${TOKEN}`,
    });
  });

  it('does not return Authorization for requests to another origin', () => {
    expect(scopedBearerHeaders('https://example.com/api/user', TARGET_URL, TOKEN)).toBeUndefined();
  });

  it('resolves relative URLs against the target origin', () => {
    expect(scopedBearerHeaders('/api/user', TARGET_URL, TOKEN)).toEqual({
      Authorization: `Bearer ${TOKEN}`,
    });
  });
});
