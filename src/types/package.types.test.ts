import { getPackageRenderType } from './package.types';

describe('getPackageRenderType', () => {
  it('returns interactive for guide-type manifests', () => {
    expect(getPackageRenderType({ type: 'guide' })).toBe('interactive');
  });

  it('returns learning-journey for path-type manifests', () => {
    expect(getPackageRenderType({ type: 'path' })).toBe('learning-journey');
  });

  it('returns learning-journey for journey-type manifests', () => {
    expect(getPackageRenderType({ type: 'journey' })).toBe('learning-journey');
  });

  it('returns interactive when manifest is undefined', () => {
    expect(getPackageRenderType(undefined)).toBe('interactive');
  });

  it('returns interactive when manifest has no type field', () => {
    expect(getPackageRenderType({ id: 'some-package' })).toBe('interactive');
  });

  it('returns interactive when manifest.type is not a string', () => {
    expect(getPackageRenderType({ type: 42 })).toBe('interactive');
  });

  it('returns interactive for unrecognized manifest.type values', () => {
    expect(getPackageRenderType({ type: 'unknown-type' })).toBe('interactive');
  });
});
