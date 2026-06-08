/**
 * Build Snippets Command
 *
 * Scans a snippets directory for snippet bodies (`<id>.json`), validates
 * each against JsonSnippetSchema, and emits a denormalized `index.json`
 * catalog (the body shape minus `blocks`). The body is the source of
 * truth; `index.json` is always regenerated, never hand-edited.
 *
 * The catalog feeds the editor's Snippet Picker via the snippet engine's
 * online resolver, which fetches `<cdn>/guides/shared/snippets/index.json`.
 * Because the resolver fetches each body at `<cdn>/.../<id>.json`, the
 * file name MUST equal the snippet's `id` — the command enforces this.
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';

import { JsonSnippetSchema, SnippetCatalogSchema } from '../../types/json-snippet.schema';
import type { SnippetCatalog, SnippetCatalogEntry } from '../../types/json-snippet.types';
import { readJsonFile } from '../../validation/package-io';

const CATALOG_FILENAME = 'index.json';

interface BuildSnippetsOptions {
  output?: string;
  check?: boolean;
}

async function formatJson(json: string): Promise<string> {
  const prettier = await import('prettier');
  const config = await prettier.resolveConfig(process.cwd());
  const formatted = await prettier.format(json, { ...(config ?? {}), parser: 'json' });
  return formatted.endsWith('\n') ? formatted : `${formatted}\n`;
}

/**
 * Build a snippet catalog from a directory of snippet bodies.
 *
 * Each `*.json` file in the directory (except `index.json`) is read and
 * validated. The resulting catalog is keyed by snippet id and sorted for
 * deterministic output.
 */
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
    // Only carry schemaVersion into the catalog when the body set it
    // explicitly — the schema default would otherwise bloat every entry.
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

export const buildSnippetsCommand = new Command('build-snippets')
  .description('Build index.json from a directory of snippet bodies')
  .argument('<dir>', 'Directory containing snippet bodies (<id>.json)')
  .option('-o, --output <file>', 'Output file path (default: <dir>/index.json)')
  .option('--check', 'Verify the existing index.json is up to date; exit 1 if it would change')
  .action(async (dir: string, options: BuildSnippetsOptions) => {
    const absoluteDir = path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir);
    const { catalog, warnings, errors } = buildSnippetCatalog(absoluteDir);

    for (const warning of warnings) {
      console.warn(`⚠️  ${warning}`);
    }
    for (const error of errors) {
      console.error(`❌ ${error}`);
    }
    if (errors.length > 0) {
      console.error(`❌ ${errors.length} error(s) prevented building index.json; no output written.`);
      process.exit(1);
    }

    const json = await formatJson(JSON.stringify(catalog, null, 2));
    const outputPath = options.output
      ? path.isAbsolute(options.output)
        ? options.output
        : path.resolve(process.cwd(), options.output)
      : path.join(absoluteDir, CATALOG_FILENAME);

    if (options.check) {
      const existing = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf-8') : '';
      if (existing !== json) {
        console.error(`❌ ${outputPath} is out of date. Run build-snippets to regenerate it.`);
        process.exit(1);
      }
      console.log(`✅ index.json is up to date (${Object.keys(catalog).length} snippets)`);
      return;
    }

    fs.writeFileSync(outputPath, json, 'utf-8');
    console.log(`✅ Wrote ${outputPath} (${Object.keys(catalog).length} snippets)`);
  });
