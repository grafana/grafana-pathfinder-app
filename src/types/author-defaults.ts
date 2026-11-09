export const EDITOR_FALLBACK_AUTHOR = 'pathfinder-block-editor';
export const MCP_FALLBACK_AUTHOR = 'pathfinder-mcp';
export const FALLBACK_AUTHOR_NAMES: readonly string[] = [EDITOR_FALLBACK_AUTHOR, MCP_FALLBACK_AUTHOR];

export function isFallbackAuthorName(name: string | undefined): boolean {
  return name !== undefined && FALLBACK_AUTHOR_NAMES.includes(name);
}
