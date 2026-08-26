import { resolveFullScreenFallbackLocation } from './full-screen-fallback-location';

describe('resolveFullScreenFallbackLocation', () => {
  it('returns a real authored location unchanged', () => {
    expect(resolveFullScreenFallbackLocation('/connections')).toBe('/connections');
  });

  it('treats the root path as no signal — indistinguishable from an unauthored default elsewhere in the app', () => {
    expect(resolveFullScreenFallbackLocation('/')).toBeUndefined();
  });

  it('treats missing as no signal', () => {
    expect(resolveFullScreenFallbackLocation(undefined)).toBeUndefined();
  });

  it('trims whitespace before comparing against the root path', () => {
    expect(resolveFullScreenFallbackLocation('  /  ')).toBeUndefined();
    expect(resolveFullScreenFallbackLocation('  /connections  ')).toBe('/connections');
  });
});
