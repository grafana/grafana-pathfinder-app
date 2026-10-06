/**
 * Shared constants used across the MCP server and tool surface.
 * Hoisted here so cross-file consumers reference one canonical value
 * rather than redeclaring the literal at each call site.
 */

export { PLUGIN_VIEWER_BASE } from '../../utils/launch-link';

/** Common prefix for per-call MCP tmpdirs. Callers may append a suffix. */
export const MCP_TMPDIR_PREFIX = 'pathfinder-cli-mcp-';
