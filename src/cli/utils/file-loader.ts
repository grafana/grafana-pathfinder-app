/**
 * File loading utilities for CLI
 */

import * as fs from 'fs';
import * as path from 'path';

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
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

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

/**
 * Load all bundled guides from src/bundled-interactives/
 *
 * Discovers guides in two formats:
 * 1. Package directories containing content.json (preferred)
 * 2. Flat JSON files at root level (legacy, excludes index.json and repository.json)
 *
 * The static-links/ subdirectory is skipped as those are recommendation
 * rule files, not interactive guides.
 */
export function loadBundledGuides(): LoadedGuide[] {
  const guides: LoadedGuide[] = [];
  const bundledDir = path.resolve(process.cwd(), 'src/bundled-interactives');

  if (!fs.existsSync(bundledDir)) {
    return guides;
  }

  const NON_GUIDE_FILES = new Set(['index.json', 'repository.json']);
  const entries = fs.readdirSync(bundledDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && entry.name !== 'static-links') {
      const contentPath = path.join(bundledDir, entry.name, 'content.json');
      if (fs.existsSync(contentPath)) {
        const guide = loadGuideFile(contentPath);
        if (guide) {
          guides.push(guide);
        }
      }
    }

    if (entry.isFile() && entry.name.endsWith('.json') && !NON_GUIDE_FILES.has(entry.name)) {
      const guide = loadGuideFile(path.join(bundledDir, entry.name));
      if (guide) {
        guides.push(guide);
      }
    }
  }

  return guides;
}
