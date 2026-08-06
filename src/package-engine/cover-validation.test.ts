import { nonEmptyCoverBlocksError } from './cover-validation';
import type { ContentJson, ManifestJson } from '../types/package.types';

const path: ManifestJson = { id: 'my-path', type: 'path' };
const journey: ManifestJson = { id: 'my-journey', type: 'journey' };
const guide: ManifestJson = { id: 'my-guide', type: 'guide' };

function content(blocks: ContentJson['blocks']): ContentJson {
  return { id: 'my-path', title: 'My path', blocks };
}

describe('nonEmptyCoverBlocksError', () => {
  it('returns a validation-error failure for a path with empty blocks', () => {
    const result = nonEmptyCoverBlocksError('my-path', path, content([]));
    expect(result).toEqual({
      ok: false,
      id: 'my-path',
      error: {
        code: 'validation-error',
        message: 'Package "my-path" is a path but has no cover content (blocks is empty)',
      },
    });
  });

  it('returns a validation-error failure for a journey with empty blocks', () => {
    const result = nonEmptyCoverBlocksError('my-journey', journey, content([]));
    expect(result?.ok).toBe(false);
    if (!result || result.ok) {
      return;
    }
    expect(result.error.message).toContain('journey');
  });

  it('returns null for a path with non-empty blocks', () => {
    const result = nonEmptyCoverBlocksError('my-path', path, content([{ type: 'markdown', content: 'hi' }]));
    expect(result).toBeNull();
  });

  it('returns null for a plain guide with empty blocks (not a metapackage)', () => {
    const result = nonEmptyCoverBlocksError('my-guide', guide, content([]));
    expect(result).toBeNull();
  });

  it('returns null when manifest is undefined', () => {
    const result = nonEmptyCoverBlocksError('my-guide', undefined, content([]));
    expect(result).toBeNull();
  });

  it('returns null when content is undefined (metadata-only resolution)', () => {
    const result = nonEmptyCoverBlocksError('my-path', path, undefined);
    expect(result).toBeNull();
  });
});
