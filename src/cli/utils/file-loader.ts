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
 * Note: static-links/ subdirectory is skipped as those are static link
 * rule files, not interactive guides.
 */
export function loadBundledGuides(): LoadedGuide[] {
  const guides: LoadedGuide[] = [];
  const bundledDir = path.resolve(process.cwd(), 'src/bundled-interactives');

  if (!fs.existsSync(bundledDir)) {
    return guides;
  }

  // Load JSON files from root directory only
  // Skip index.json (manifest file) and static-links/ (different format)
  const rootFiles = fs.readdirSync(bundledDir);
  for (const file of rootFiles) {
    if (file.endsWith('.json') && file !== 'index.json') {
      const guide = loadGuideFile(path.join(bundledDir, file));
      if (guide) {
        guides.push(guide);
      }
    }
  }

  return guides;
}
