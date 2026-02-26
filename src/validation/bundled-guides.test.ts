/**
 * Bundled Guides Validation Tests
 *
 * Ensures all bundled JSON guides pass validation.
 * Guides are stored as package directories (e.g., welcome-to-grafana/content.json).
 */

import * as fs from 'fs';
import * as path from 'path';

import { validateGuideFromString, toLegacyResult } from './index';

/**
 * Collect all guide files from the bundled-interactives directory.
 * Guides live in package directories as content.json files.
 * Falls back to flat JSON files for any not yet migrated.
 */
function collectGuideFiles(): Array<{ filePath: string; fileName: string }> {
  const bundledDir = path.resolve(__dirname, '../bundled-interactives');
  const files: Array<{ filePath: string; fileName: string }> = [];

  if (!fs.existsSync(bundledDir)) {
    return files;
  }

  const entries = fs.readdirSync(bundledDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name !== 'static-links') {
      const contentPath = path.join(bundledDir, entry.name, 'content.json');
      if (fs.existsSync(contentPath)) {
        files.push({ filePath: contentPath, fileName: `${entry.name}/content.json` });
      }
    }

    if (
      entry.isFile() &&
      entry.name.endsWith('.json') &&
      entry.name !== 'index.json' &&
      entry.name !== 'repository.json'
    ) {
      files.push({ filePath: path.join(bundledDir, entry.name), fileName: entry.name });
    }
  }

  return files;
}

const guideFiles = collectGuideFiles();

describe('Bundled Guides', () => {
  it('should have bundled guides to test', () => {
    expect(guideFiles.length).toBeGreaterThan(0);
  });

  if (guideFiles.length > 0) {
    describe.each(guideFiles)('$fileName', ({ filePath, fileName }) => {
      let content: string;

      beforeAll(() => {
        content = fs.readFileSync(filePath, 'utf-8');
      });

      it('should be valid JSON', () => {
        expect(() => JSON.parse(content)).not.toThrow();
      });

      it('should pass validation', () => {
        const result = validateGuideFromString(content);
        if (!result.isValid) {
          const legacy = toLegacyResult(result);
          throw new Error(`Validation failed for ${fileName}:\n${legacy.errors.join('\n')}`);
        }
        expect(result.isValid).toBe(true);
      });

      it('should have no issues in strict mode', () => {
        const result = validateGuideFromString(content, { strict: true });
        if (!result.isValid) {
          const legacy = toLegacyResult(result);
          throw new Error(`Strict mode failed for ${fileName}:\n${legacy.errors.join('\n')}`);
        }
        expect(result.isValid).toBe(true);
      });
    });
  }
});
