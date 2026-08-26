/**
 * `build-snippets` — generates the snippet catalog (`index.json`) from a
 * directory of snippet bodies. Bodies are the source of truth; the catalog
 * is always regenerated, never hand-edited.
 */

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

import { JsonSnippetSchema, SnippetCatalogSchema } from '../../types/json-snippet.schema';
import type { SnippetCatalog, SnippetCatalogEntry } from '../../types/json-snippet.types';
import { readJsonFile } from '../../validation/package-io';
import { defineCommand } from '../contracts';
import { resolveCliPath } from '../utils/file-loader';
import { formatJsonWithPrettier, type CommandOutcome } from '../utils/output';

const CATALOG_FILENAME = 'index.json';

export function buildSnippetCatalog(dir: string): {
  catalog: SnippetCatalog;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];
  const catalog: SnippetCatalog = {};

  if (!fs.existsSync(dir)) {
    errors.push(`Snippets directory not found: ${dir}`);
    return { catalog, warnings, errors };
  }

  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && entry.name !== CATALOG_FILENAME)
    .map((entry) => entry.name)
    .sort();

  if (files.length === 0) {
    warnings.push(`No snippet bodies (*.json) found under ${dir}`);
    return { catalog, warnings, errors };
  }

  for (const file of files) {
    const filePath = path.join(dir, file);
    const fileId = file.slice(0, -'.json'.length);

    const read = readJsonFile(filePath, JsonSnippetSchema);
    if (!read.ok) {
      const detail =
        read.code === 'schema_validation'
          ? read.issues?.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
          : read.message;
      errors.push(`${file}: ${detail}`);
      continue;
    }

    const snippet = read.data;

    // The resolver fetches `<id>.json`, so the file name must equal the id.
    if (snippet.id !== fileId) {
      errors.push(`${file}: id "${snippet.id}" does not match file name (expected "${fileId}.json")`);
      continue;
    }

    if (catalog[snippet.id] !== undefined) {
      errors.push(`${file}: duplicate snippet id "${snippet.id}"`);
      continue;
    }

    const entry: SnippetCatalogEntry = {
      id: snippet.id,
      title: snippet.title,
      description: snippet.description,
    };
    if (snippet.category !== undefined) {
      entry.category = snippet.category;
    }
    if (snippet.tags !== undefined) {
      entry.tags = snippet.tags;
    }
    // Carry schemaVersion only when the body set it explicitly — the schema
    // default would otherwise bloat every entry.
    if (read.parsed && typeof read.parsed === 'object' && 'schemaVersion' in read.parsed) {
      entry.schemaVersion = snippet.schemaVersion;
    }

    catalog[snippet.id] = entry;
  }

  const validation = SnippetCatalogSchema.safeParse(catalog);
  if (!validation.success) {
    errors.push(`Generated index.json is invalid: ${validation.error.issues.map((i) => i.message).join('; ')}`);
  }

  return { catalog, warnings, errors };
}

export const BuildSnippetsCommand = z.object({
  dir: z.string().describe('Directory containing snippet bodies (<id>.json)').meta({ role: 'io' }),
  output: z.string().optional().describe('Output file path (default: <dir>/index.json)').meta({ role: 'io' }),
});

export type BuildSnippetsInput = z.output<typeof BuildSnippetsCommand>;

export async function runBuildSnippets(args: BuildSnippetsInput): Promise<CommandOutcome> {
  const absoluteDir = resolveCliPath(args.dir);
  const { catalog, warnings, errors } = buildSnippetCatalog(absoluteDir);

  for (const warning of warnings) {
    console.warn(`⚠️  ${warning}`);
  }
  for (const error of errors) {
    console.error(`❌ ${error}`);
  }
  if (errors.length > 0) {
    console.error(`❌ ${errors.length} error(s) prevented building index.json; no output written.`);
    return { status: 'error', code: 'BUILD_FAILED', message: `${errors.length} error(s) building index.json` };
  }

  const json = await formatJsonWithPrettier(JSON.stringify(catalog, null, 2));
  const outputPath = args.output ? resolveCliPath(args.output) : path.join(absoluteDir, CATALOG_FILENAME);

  fs.writeFileSync(outputPath, json, 'utf-8');
  console.log(`✅ Wrote ${outputPath} (${Object.keys(catalog).length} snippets)`);
  return { status: 'ok', summary: `Wrote ${outputPath}` };
}

export const buildSnippetsSpec = defineCommand({
  name: 'build-snippets',
  summary: 'Build index.json from a directory of snippet bodies',
  schema: BuildSnippetsCommand,
  // Progress lines and the ❌/✅ trailers are the output contract CI reads.
  emits: 'stream',
  run: runBuildSnippets,
});
