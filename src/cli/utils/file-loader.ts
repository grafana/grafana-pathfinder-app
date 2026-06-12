/**
 * File loading utilities for CLI
 */

import * as fs from 'fs';
import * as path from 'path';
import type { RepositoryJson } from '../../types/package.types';
import { RepositoryJsonSchema } from '../../types/package.schema';
import { readJsonFile } from '../../validation/package-io';

/**
 * Resolve a user-supplied CLI path to an absolute path. Pass `base` to resolve
 * against something other than `process.cwd()` (e.g., a configured project
 * root). The base only kicks in for relative inputs — absolute paths pass
 * through unchanged.
 */
export function resolveCliPath(input: string, base: string = process.cwd()): string {
  return path.isAbsolute(input) ? input : path.resolve(base, input);
}

export interface LoadedGuide {
  path: string;
  content: string;
}

/**
 * Load guide files from the file system
 */
export function loadGuideFiles(filePaths: string[]): LoadedGuide[] {
  const guides: LoadedGuide[] = [];

  for (const filePath of filePaths) {
    const guide = loadGuideFile(filePath);
    if (guide) {
      guides.push(guide);
    }
  }

  return guides;
}

/**
 * Load a single guide file
 */
function loadGuideFile(filePath: string): LoadedGuide | null {
  try {
    const absolutePath = resolveCliPath(filePath);

    if (!fs.existsSync(absolutePath)) {
      console.warn(`File not found: ${filePath}`);
      return null;
    }

    if (!filePath.endsWith('.json')) {
      console.warn(`Skipping non-JSON file: ${filePath}`);
      return null;
    }

    const content = fs.readFileSync(absolutePath, 'utf-8');
    return { path: filePath, content };
  } catch (error) {
    console.warn(`Error reading file ${filePath}:`, error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
}

export interface DiscoveredGuide {
  /** Absolute path to the guide JSON file */
  filePath: string;
  /** Display name (e.g., "welcome-to-grafana/content.json" or "legacy.json") */
  displayName: string;
}

const NON_GUIDE_FILES = new Set(['index.json', 'repository.json']);

/**
 * Discover guide files under a bundled-interactives directory.
 *
 * Finds guides in two formats:
 * 1. Package directories containing content.json (preferred)
 * 2. Flat JSON files at root level (legacy, excludes index.json and repository.json)
 *
 * The static-links/ subdirectory is skipped as those are recommendation
 * rule files, not interactive guides.
 */
export function discoverBundledGuideFiles(bundledDir: string): DiscoveredGuide[] {
  const guides: DiscoveredGuide[] = [];

  if (!fs.existsSync(bundledDir)) {
    return guides;
  }

  const entries = fs.readdirSync(bundledDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && entry.name !== 'static-links') {
      const contentPath = path.join(bundledDir, entry.name, 'content.json');
      if (fs.existsSync(contentPath)) {
        guides.push({ filePath: contentPath, displayName: `${entry.name}/content.json` });
      }
    }

    if (entry.isFile() && entry.name.endsWith('.json') && !NON_GUIDE_FILES.has(entry.name)) {
      guides.push({ filePath: path.join(bundledDir, entry.name), displayName: entry.name });
    }
  }

  return guides;
}

/**
 * Load all bundled guides from src/bundled-interactives/
 */
export function loadBundledGuides(): LoadedGuide[] {
  const bundledDir = path.resolve(process.cwd(), 'src/bundled-interactives');
  const discovered = discoverBundledGuideFiles(bundledDir);
  const guides: LoadedGuide[] = [];

  for (const { filePath } of discovered) {
    const guide = loadGuideFile(filePath);
    if (guide) {
      guides.push(guide);
    }
  }

  return guides;
}

export function bundledRepositoryPath(): string {
  return path.resolve(process.cwd(), 'src/bundled-interactives/repository.json');
}

/**
 * Load and validate a repository.json index from disk.
 *
 * Returns the parsed index on success, or `null` when the file does not
 * exist or fails schema validation.
 */
export function loadRepositoryIndex(filePath: string): { repository: RepositoryJson | null; error?: string } {
  const result = readJsonFile(filePath, RepositoryJsonSchema);
  if (!result.ok) {
    const error =
      result.code === 'schema_validation'
        ? `repository.json validation failed: ${result.issues?.map((i) => i.message).join('; ')}`
        : result.message;
    return { repository: null, error };
  }
  return { repository: result.data };
}
