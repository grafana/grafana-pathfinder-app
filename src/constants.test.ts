import { getDefaultRecommenderUrl, getConfigWithDefaults, isKnownRecommenderUrl, DocsPluginConfig } from './constants';

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

describe('isKnownRecommenderUrl', () => {
  it('recognises the prod recommender URL', () => {
    expect(isKnownRecommenderUrl('https://recommender.grafana.com')).toBe(true);
  });

  it('recognises the dev recommender URL', () => {
    expect(isKnownRecommenderUrl('https://recommender.grafana-dev.com')).toBe(true);
  });

  it('strips trailing slashes before comparing', () => {
    expect(isKnownRecommenderUrl('https://recommender.grafana.com/')).toBe(true);
  });

  it('rejects custom URLs', () => {
    expect(isKnownRecommenderUrl('http://localhost:8080')).toBe(false);
    expect(isKnownRecommenderUrl('https://my-custom-recommender.example.com')).toBe(false);
  });
});

describe('getConfigWithDefaults recommender wiring', () => {
  it('uses auto-detection when a known recommender URL is saved (prevents CORS mismatch)', () => {
    const pluginConfig: DocsPluginConfig = {
      recommenderServiceUrl: 'https://recommender.grafana.com',
    };
    const result = getConfigWithDefaults(pluginConfig);
    expect(result.recommenderServiceUrl).toBe(getDefaultRecommenderUrl());
  });

  it('respects custom (non-known) recommenderServiceUrl override', () => {
    const pluginConfig: DocsPluginConfig = {
      recommenderServiceUrl: 'http://localhost:8080',
    };
    const result = getConfigWithDefaults(pluginConfig);
    expect(result.recommenderServiceUrl).toBe('http://localhost:8080');
  });

  it('falls back to getDefaultRecommenderUrl when no override is set', () => {
    const result = getConfigWithDefaults({});
    expect(result.recommenderServiceUrl).toBe('https://recommender.grafana.com');
  });
});
