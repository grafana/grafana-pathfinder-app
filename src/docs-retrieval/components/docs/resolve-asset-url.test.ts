import { resolveAssetUrl } from './resolve-asset-url';

describe('resolveAssetUrl', () => {
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
