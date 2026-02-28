/**
 * Bundled Guides Validation Tests
 *
 * Ensures all bundled JSON guides pass validation.
 * Guides are stored as package directories (e.g., welcome-to-grafana/content.json).
 */

import * as fs from 'fs';
import * as path from 'path';

import { discoverBundledGuideFiles } from '../cli/utils/file-loader';

import { validateGuideFromString, toLegacyResult } from './index';

function collectGuideFiles(): Array<{ filePath: string; fileName: string }> {
  const bundledDir = path.resolve(__dirname, '../bundled-interactives');
  return discoverBundledGuideFiles(bundledDir).map((g) => ({
    filePath: g.filePath,
    fileName: g.displayName,
  }));
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
