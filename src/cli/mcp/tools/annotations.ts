/**
 * Shared MCP ToolAnnotations factories.
 *
 * Each Pathfinder MCP tool exposes annotations so clients (Grafana Assistant,
 * Inspector, …) can render a human-friendly title and label the call as
 * read-only vs a write. The two factories below cover every shape we
 * actually use; pick the one that matches what the tool does to the artifact
 * (or external world) and pass a sentence-case title.
 *
 * Note on writes: every authoring write here mutates an in-flight authoring
 * artifact (session or echoed), never live Grafana data — so the write tools
 * carry `destructiveHint: false` explicitly (`writeAppend`). The MCP spec
 * defaults `destructiveHint` to true when absent, so omitting the field would
 * read as destructive to compliant clients.
 *
 * See https://modelcontextprotocol.io/specification/2025-11-25/schema#toolannotations
 */

type ReadOnly = {
  title: string;
  readOnlyHint: true;
  idempotentHint: true;
  openWorldHint: boolean;
};

type WriteAppend = {
  title: string;
  readOnlyHint: false;
  destructiveHint: false;
};

export const readOnly = (title: string, openWorldHint = false): ReadOnly => ({
  title,
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint,
});

export const writeAppend = (title: string): WriteAppend => ({
  title,
  readOnlyHint: false,
  destructiveHint: false,
});
