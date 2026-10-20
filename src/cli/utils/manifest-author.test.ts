import { EDITOR_FALLBACK_AUTHOR, MCP_FALLBACK_AUTHOR } from '../../types/author-defaults';
import { resolveAuthor, withManifestAuthor } from './manifest-author';

const git = () => 'Ada Lovelace';

describe('resolveAuthor', () => {
  it('falls back to pathfinder-mcp when nothing is supplied or inferable', () => {
    expect(resolveAuthor(undefined)).toEqual({ name: MCP_FALLBACK_AUTHOR });
  });

  it('uses the local identity when there is no author', () => {
    expect(resolveAuthor(undefined, { localName: git })).toEqual({ name: 'Ada Lovelace' });
  });

  it('treats an empty local identity as absent', () => {
    expect(resolveAuthor(undefined, { localName: () => undefined })).toEqual({ name: MCP_FALLBACK_AUTHOR });
    expect(resolveAuthor(undefined, { localName: () => '  ' })).toEqual({ name: MCP_FALLBACK_AUTHOR });
  });

  it('lets a supplied name win over everything, including a real existing author', () => {
    expect(resolveAuthor({ name: 'Grace' }, { supplied: { name: 'Ada' }, localName: () => 'Local' })).toEqual({
      name: 'Ada',
    });
  });

  it('keeps a real existing author and ignores the local identity', () => {
    expect(resolveAuthor({ name: 'Grace', team: 'Core' }, { localName: git })).toEqual({ name: 'Grace', team: 'Core' });
  });

  it('replaces a fallback author with a real local identity', () => {
    expect(resolveAuthor({ name: EDITOR_FALLBACK_AUTHOR }, { localName: git })).toEqual({ name: 'Ada Lovelace' });
    expect(resolveAuthor({ name: MCP_FALLBACK_AUTHOR }, { localName: git })).toEqual({ name: 'Ada Lovelace' });
  });

  it('never swaps one fallback for the other', () => {
    expect(resolveAuthor({ name: EDITOR_FALLBACK_AUTHOR })).toEqual({ name: EDITOR_FALLBACK_AUTHOR });
    expect(resolveAuthor({ name: MCP_FALLBACK_AUTHOR })).toEqual({ name: MCP_FALLBACK_AUTHOR });
  });

  it('fills a missing name while keeping the team', () => {
    expect(resolveAuthor({ team: 'Core' })).toEqual({ name: MCP_FALLBACK_AUTHOR, team: 'Core' });
  });

  it('carries a supplied team', () => {
    expect(resolveAuthor(undefined, { supplied: { team: 'Docs' } })).toEqual({
      name: MCP_FALLBACK_AUTHOR,
      team: 'Docs',
    });
  });

  it('does not call the local identity thunk when a name is already settled', () => {
    const spy = jest.fn(() => 'x');
    resolveAuthor({ name: 'Grace' }, { localName: spy });
    resolveAuthor(undefined, { supplied: { name: 'Ada' }, localName: spy });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('withManifestAuthor', () => {
  it('adds the author to a manifest that has none, leaving every other field alone', () => {
    const manifest = { id: 'g', type: 'guide', schemaVersion: '1.1.0', repository: 'r' };
    expect(withManifestAuthor(manifest, { id: 'g' })).toEqual({ ...manifest, author: { name: MCP_FALLBACK_AUTHOR } });
  });

  it('does not invent startingLocation, minGrafanaVersion, targeting or category', () => {
    const result = withManifestAuthor({ id: 'g', type: 'guide', schemaVersion: '1.1.0' }, { id: 'g' });
    for (const key of ['startingLocation', 'minGrafanaVersion', 'targeting', 'category', 'description']) {
      expect(result).not.toHaveProperty(key);
    }
  });

  it('builds the smallest valid manifest when the artifact carried none', () => {
    expect(withManifestAuthor(undefined, { id: 'g' })).toEqual({
      schemaVersion: expect.any(String),
      id: 'g',
      type: 'guide',
      author: { name: MCP_FALLBACK_AUTHOR },
    });
  });
});
