/**
 * Bundled Guides Validation Tests
 *
 * Ensures all bundled JSON guides pass validation.
 */

import * as fs from 'fs';
import * as path from 'path';

import { validateGuideFromString, toLegacyResult } from '../';

/**
 * Collect all guide files from the bundled-interactives directory.
 * Excludes index.json and static-links subdirectory.
 */
function collectGuideFiles(): Array<{ filePath: string; fileName: string }> {
  const bundledDir = path.resolve(__dirname, '../../bundled-interactives');
  const files: Array<{ filePath: string; fileName: string }> = [];

  if (!fs.existsSync(bundledDir)) {
    return files;
  }

  const entries = fs.readdirSync(bundledDir);
  for (const entry of entries) {
    // Skip index.json and directories (like static-links)
    if (entry === 'index.json') {
      continue;
    }

    const fullPath = path.join(bundledDir, entry);
    const stat = fs.statSync(fullPath);

    if (stat.isFile() && entry.endsWith('.json')) {
      files.push({ filePath: fullPath, fileName: entry });
    }
  }

  return files;
}

const guideFiles = collectGuideFiles();

describe('Bundled Guides', () => {
  it('should have bundled guides to test', () => {
    expect(guideFiles.length).toBeGreaterThan(0);
  });

  // Only run the parameterized tests if we have guide files
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
          fail(`Validation failed for ${fileName}:\n${legacy.errors.join('\n')}`);
        }
        expect(result.isValid).toBe(true);
      });

      it('should have no issues in strict mode', () => {
        const result = validateGuideFromString(content, { strict: true });
        if (!result.isValid) {
          const legacy = toLegacyResult(result);
          fail(`Strict mode failed for ${fileName}:\n${legacy.errors.join('\n')}`);
        }
        expect(result.isValid).toBe(true);
      });
    });
  }
});

