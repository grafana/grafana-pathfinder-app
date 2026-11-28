import { resolveAssetUrl } from './resolve-asset-url';
import { isDevModeEnabledGlobal } from '../../../utils/dev-mode';

jest.mock('../../../utils/dev-mode', () => ({
  ...jest.requireActual('../../../utils/dev-mode'),
  isDevModeEnabledGlobal: jest.fn(() => false),
}));

describe('resolveAssetUrl', () => {
  it('pins recognized CDN assets and relative assets only during dev-mode previews', () => {
    const enabled = jest.mocked(isDevModeEnabledGlobal).mockReturnValue(true);
    try {
      const root = `https://raw.githubusercontent.com/fork/repo/${'a'.repeat(40)}`;
      const base = `${root}/guide/content.json#pf-pr-kiosk123`;
      const cdn = 'https://interactive-learning.grafana.net/packages/guide/assets/image.png';
      expect(resolveAssetUrl(cdn, base)).toBe(`${root}/guide/assets/image.png`);
      expect(resolveAssetUrl('assets/image.png', base)).toBe(`${root}/guide/assets/image.png`);
      expect(resolveAssetUrl('https://example.com/image.png', base)).toBe('https://example.com/image.png');
      enabled.mockReturnValue(false);
      expect(resolveAssetUrl(cdn, base)).toBe(cdn);
    } finally {
      enabled.mockReturnValue(false);
    }
  });
  describe('absolute inputs pass through unchanged', () => {
    it.each([
      'https://cdn.example.com/video.mp4',
      'http://cdn.example.com/video.mp4',
      '//cdn.example.com/video.mp4',
      'data:video/mp4;base64,AAAA',
    ])('preserves %s', (src) => {
      expect(resolveAssetUrl(src, 'https://grafana.com/docs/')).toBe(src);
    });
  });

  describe('relative inputs resolve against baseUrl', () => {
    it('resolves a bare relative path against a file-style base URL', () => {
      expect(resolveAssetUrl('assets/demo.mp4', 'https://cdn.example.com/pkg/content.json')).toBe(
        'https://cdn.example.com/pkg/assets/demo.mp4'
      );
    });

    it('resolves a root-absolute path against the base origin', () => {
      expect(resolveAssetUrl('/media/demo.mp4', 'https://cdn.example.com/pkg/content.json')).toBe(
        'https://cdn.example.com/media/demo.mp4'
      );
    });

    it('resolves a dot-relative path', () => {
      expect(resolveAssetUrl('./demo.mp4', 'https://cdn.example.com/pkg/')).toBe(
        'https://cdn.example.com/pkg/demo.mp4'
      );
    });
  });

  describe('synthetic bases fall back to grafana.com', () => {
    it.each(['block-editor://preview/123', 'bundled:first-dashboard/content.json'])(
      'falls back for base %s',
      (base) => {
        expect(resolveAssetUrl('assets/demo.mp4', base)).toBe('https://grafana.com/assets/demo.mp4');
      }
    );
  });

  describe('missing baseUrl', () => {
    it('returns the relative src unchanged when no baseUrl is provided', () => {
      expect(resolveAssetUrl('assets/demo.mp4', undefined)).toBe('assets/demo.mp4');
    });
  });
});

it.each([
  'http://[invalid',
  'https://interactive-learning.grafana.net/packages/guide/%2e%2e%2fimage.png',
  'https://interactive-learning.grafana.net/packages/guide/%ZZ.png',
])('leaves malformed preview assets unresolved without throwing: %s', (src) => {
  jest.mocked(isDevModeEnabledGlobal).mockReturnValue(true);
  try {
    const base = `https://raw.githubusercontent.com/fork/repo/${'a'.repeat(40)}/guide/content.json#pf-pr-kiosk123`;
    expect(resolveAssetUrl(src, base)).toBe('');
  } finally {
    jest.mocked(isDevModeEnabledGlobal).mockReturnValue(false);
  }
});
