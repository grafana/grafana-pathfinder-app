import {
  EDITOR_FALLBACK_AUTHOR,
  FALLBACK_AUTHOR_NAMES,
  MCP_FALLBACK_AUTHOR,
  isFallbackAuthorName,
} from './author-defaults';

describe('author defaults', () => {
  it('keeps the two surfaces distinguishable', () => {
    expect(EDITOR_FALLBACK_AUTHOR).not.toBe(MCP_FALLBACK_AUTHOR);
    expect(FALLBACK_AUTHOR_NAMES).toEqual([EDITOR_FALLBACK_AUTHOR, MCP_FALLBACK_AUTHOR]);
  });

  it('matches only the exact placeholder names', () => {
    expect(isFallbackAuthorName('pathfinder-block-editor')).toBe(true);
    expect(isFallbackAuthorName('pathfinder-mcp')).toBe(true);
    expect(isFallbackAuthorName('Pathfinder-MCP')).toBe(false);
    expect(isFallbackAuthorName('pathfinder-mcp-fork')).toBe(false);
    expect(isFallbackAuthorName('')).toBe(false);
    expect(isFallbackAuthorName(undefined)).toBe(false);
  });
});
