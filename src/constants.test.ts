import { getDefaultRecommenderUrl, getConfigWithDefaults, DocsPluginConfig } from './constants';

describe('getDefaultRecommenderUrl', () => {
  it('returns dev recommender for *.grafana-dev.net hosts', () => {
    expect(getDefaultRecommenderUrl('myinstance.grafana-dev.net')).toBe('https://recommender.grafana-dev.com');
  });

  it('returns dev recommender for deeply nested grafana-dev.net hosts', () => {
    expect(getDefaultRecommenderUrl('foo.bar.grafana-dev.net')).toBe('https://recommender.grafana-dev.com');
  });

  it('returns prod recommender for *.grafana.com hosts', () => {
    expect(getDefaultRecommenderUrl('myinstance.grafana.com')).toBe('https://recommender.grafana.com');
  });

  it('returns prod recommender for *.grafana-ops.net hosts', () => {
    expect(getDefaultRecommenderUrl('myinstance.grafana-ops.net')).toBe('https://recommender.grafana.com');
  });

  it('returns prod recommender for localhost', () => {
    expect(getDefaultRecommenderUrl('localhost')).toBe('https://recommender.grafana.com');
  });

  it('returns prod recommender for play.grafana.org', () => {
    expect(getDefaultRecommenderUrl('play.grafana.org')).toBe('https://recommender.grafana.com');
  });

  it('falls back to prod when called without override (jsdom default)', () => {
    expect(getDefaultRecommenderUrl()).toBe('https://recommender.grafana.com');
  });
});

describe('getConfigWithDefaults recommender wiring', () => {
  it('respects explicit recommenderServiceUrl override', () => {
    const pluginConfig: DocsPluginConfig = {
      recommenderServiceUrl: 'https://recommender.grafana-dev.com',
    };
    const result = getConfigWithDefaults(pluginConfig);
    expect(result.recommenderServiceUrl).toBe('https://recommender.grafana-dev.com');
  });

  it('falls back to getDefaultRecommenderUrl when no override is set', () => {
    const result = getConfigWithDefaults({});
    expect(result.recommenderServiceUrl).toBe('https://recommender.grafana.com');
  });
});
