/**
 * Shared constants used across the MCP server and tool surface.
 * Hoisted here so cross-file consumers reference one canonical value
 * rather than redeclaring the literal at each call site.
 */

/** Grafana plugin viewer base path. Combined with `?doc=…` for guide links. */
export const PLUGIN_VIEWER_BASE = '/a/grafana-pathfinder-app';

/** Common prefix for per-call MCP tmpdirs. Callers may append a suffix. */
export const MCP_TMPDIR_PREFIX = 'pathfinder-cli-mcp-';
