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
export function loadGuideFiles(patterns: string[]): LoadedGuide[] {
  const guides: LoadedGuide[] = [];

  for (const pattern of patterns) {
    // Handle glob patterns using basic matching
    if (pattern.includes('*')) {
      const files = expandGlob(pattern);
      for (const file of files) {
        const guide = loadGuideFile(file);
        if (guide) {
          guides.push(guide);
        }
      }
    } else {
      // Direct file path
      const guide = loadGuideFile(pattern);
      if (guide) {
        guides.push(guide);
      }
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
 * Expand simple glob patterns (supports *.json and **/*.json patterns)
 */
function expandGlob(pattern: string): string[] {
  const results: string[] = [];
  const recursiveIndex = pattern.indexOf('**/');
  const hasRecursive = recursiveIndex !== -1;
  const dirPart = hasRecursive ? pattern.slice(0, recursiveIndex) : path.dirname(pattern);
  const filePattern = hasRecursive ? pattern.slice(recursiveIndex + 3) : path.basename(pattern);
  const baseDirRelative = dirPart === '' ? '.' : dirPart;
  const baseDirAbsolute = path.isAbsolute(baseDirRelative)
    ? baseDirRelative
    : path.resolve(process.cwd(), baseDirRelative);

  // Convert glob pattern to regex (only supports * wildcards in filename)
  const regex = new RegExp('^' + filePattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');

  const walk = (absoluteDir: string, relativeDir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryAbsPath = path.join(absoluteDir, entry.name);
      const entryRelPath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;

      if (entry.isDirectory()) {
        if (hasRecursive) {
          walk(entryAbsPath, entryRelPath);
        }
        continue;
      }

      if (regex.test(entry.name)) {
        results.push(path.join(baseDirRelative, entryRelPath));
      }
    }
  };

  walk(baseDirAbsolute, '');

  return results;
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
