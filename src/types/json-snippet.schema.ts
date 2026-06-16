/**
 * Zod Schemas for JSON Snippet Types
 *
 * Runtime validation for snippet root + catalog. Reuses the existing
 * JsonBlockSchemaNoRef from json-guide.schema.ts to enforce the
 * "no nested snippet-refs" rule at every depth.
 *
 * @coupling Types: json-snippet.types.ts
 */

import { z } from 'zod';

import { JsonBlockSchemaNoRef } from './json-guide.schema';

/**
 * Snippet ID — kebab-case, matches the package-ID regex.
 */
const SnippetIdSchema = z
  .string()
  .min(1, 'Snippet id is required')
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 'Snippet id must be kebab-case');

/**
 * The current snippet schema version. Bodies that omit `schemaVersion`
 * implicitly accept the latest format.
 */
export const CURRENT_SNIPPET_SCHEMA_VERSION = '1.0.0';

/**
 * Root schema for a snippet.
 *
 * `description` is required — snippets show in the editor's picker and
 * the picker is unusable without it. `schemaVersion` is optional with
 * a default; bodies authored against v1.0.0 don't need to set it. The
 * body is the source of truth — `index.json` is regenerated from
 * bodies by `npm run snippets:build`.
 *
 * @coupling Type: JsonSnippet
 */
export const JsonSnippetSchema = z.object({
  schemaVersion: z.string().min(1).default(CURRENT_SNIPPET_SCHEMA_VERSION),
  id: SnippetIdSchema,
  title: z.string().min(1, 'Snippet title is required'),
  description: z.string().min(1, 'Snippet description is required'),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  // JsonBlockSchemaNoRef rejects snippet-ref blocks at every depth,
  // including inside section/conditional/assistant containers.
  blocks: z.array(JsonBlockSchemaNoRef).min(1, 'Snippet must contain at least one block'),
});

/**
 * Catalog entry — body shape minus `blocks`. The index is generated
 * from snippet bodies, so the entry fields track the body fields 1:1.
 */
export const SnippetCatalogEntrySchema = z.object({
  id: SnippetIdSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  schemaVersion: z.string().min(1).optional(),
});

/**
 * Catalog schema — `Record<id, SnippetCatalogEntry>`.
 */
export const SnippetCatalogSchema = z.record(z.string(), SnippetCatalogEntrySchema);

export type InferredJsonSnippet = z.infer<typeof JsonSnippetSchema>;
