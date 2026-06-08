/**
 * JSON Snippet Type Definitions
 *
 * Snippets are reusable fragments of guide schema, authored upstream in
 * `grafana/interactive-tutorials` under `shared/snippets/` and published
 * to the CDN at `<cdn>/guides/shared/snippets/<id>.json`. A guide
 * references a snippet by id via a `snippet-ref` block; the parser
 * resolves the ref and splices the snippet's blocks into the guide at
 * parse time.
 *
 * In v1 snippets may contain any block type EXCEPT another snippet-ref
 * — i.e. no nesting. The Zod schema enforces this; see
 * json-snippet.schema.ts.
 */

import type { JsonBlock } from './json-guide.types';

/**
 * Root structure for a snippet.
 * @coupling Zod schema: JsonSnippetSchema in json-snippet.schema.ts
 */
export interface JsonSnippet {
  /** Schema version for forward compatibility. Optional — defaults to the current version when absent. */
  schemaVersion?: string;
  /** Unique identifier — kebab-case, matches the upstream snippet ID */
  id: string;
  /** Human-readable title shown in the picker */
  title: string;
  /** Required: shown in the picker so authors know what the snippet does */
  description: string;
  /** Optional category for grouping in the picker */
  category?: string;
  /** Optional tags for search/filter */
  tags?: string[];
  /**
   * Snippet body. Any JsonBlock is allowed except `snippet-ref` —
   * v1 forbids snippet-of-snippet composition. The Zod schema rejects
   * nested refs at any depth.
   */
  blocks: JsonBlock[];
}

/**
 * Catalog entry — the body shape minus `blocks`. The picker uses this
 * to render the snippet list without fetching every body. Generated
 * from bodies by `npm run snippets:build`.
 */
export interface SnippetCatalogEntry {
  id: string;
  title: string;
  description: string;
  category?: string;
  tags?: string[];
  schemaVersion?: string;
}

/**
 * Map keyed by snippet id, matching the shape of snippets.json on disk
 * and on the CDN.
 */
export type SnippetCatalog = Record<string, SnippetCatalogEntry>;
