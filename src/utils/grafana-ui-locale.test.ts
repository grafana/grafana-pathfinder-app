import { config } from '@grafana/runtime';
import { getGrafanaUiLocale } from './grafana-ui-locale';

const bootData = config.bootData as { user?: { language?: unknown } } | undefined;
let original: unknown;

beforeEach(() => {
  original = bootData?.user;
});

afterEach(() => {
  (config.bootData as { user?: unknown }).user = original;
});

function setUser(user: unknown): void {
  (config.bootData as { user?: unknown }).user = user;
}

describe('getGrafanaUiLocale', () => {
  it("returns the user's Grafana UI locale", () => {
    setUser({ language: 'ja-JP' });
    expect(getGrafanaUiLocale()).toBe('ja-JP');
  });

  it('normalizes the case of the tag', () => {
    setUser({ language: 'pt-br' });
    expect(getGrafanaUiLocale()).toBe('pt-BR');
  });

  it.each([[undefined], [''], ['detect'], ['not a tag'], [null], [3]])('returns undefined for %j', (language) => {
    setUser({ language });
    expect(getGrafanaUiLocale()).toBeUndefined();
  });

  it('returns undefined when there is no user', () => {
    setUser(undefined);
    expect(getGrafanaUiLocale()).toBeUndefined();
  });
});
