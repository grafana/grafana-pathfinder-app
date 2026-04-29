#!/usr/bin/env node
/*
 * Placeholder for the pathfinder-mcp entrypoint.
 *
 * P2 reserves the `pathfinder-mcp` bin slot in the published npm package so
 * P3 can add the real MCP server implementation purely additively. Until
 * P3 lands, invoking `pathfinder-mcp` prints a pointer to the design doc
 * and exits non-zero so MCP clients fail loud rather than silently
 * connecting to a no-op.
 */

process.stderr.write(
  'pathfinder-mcp: not yet available — added in P3.\n' +
    'See docs/design/AI-AUTHORING-IMPLEMENTATION.md#p3--typescript-mcp-server\n'
);
process.exit(1);
