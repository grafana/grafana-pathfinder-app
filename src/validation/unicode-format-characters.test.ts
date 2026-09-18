import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { findUnicodeFormatCharacters } from './unicode-format-characters';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.webp',
  '.avif',
  '.pdf',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp3',
  '.mp4',
  '.webm',
  '.wasm',
  '.zip',
  '.gz',
]);

const MAX_REPORTED_HITS = 20;

const FORBIDDEN_CODE_POINTS = [
  0x00ad, 0x200b, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2060, 0x2066, 0x2067, 0x2068, 0x2069,
  0xfeff,
];

interface ScannedFile {
  relPath: string;
  hits: ReturnType<typeof findUnicodeFormatCharacters>;
}

function listTrackedFiles(): string[] {
  try {
    return execFileSync('git', ['ls-files', '-z'], {
      cwd: REPO_ROOT,
      maxBuffer: 64 * 1024 * 1024,
    })
      .toString('utf-8')
      .split('\0')
      .filter(Boolean);
  } catch (error) {
    throw new Error(
      `Could not enumerate tracked files with \`git ls-files\` in ${REPO_ROOT}. This guard reads the ` +
        `working-tree content of every tracked file, so it needs a git checkout with git on PATH.\n${String(error)}`
    );
  }
}

function collectScannableFiles(): string[] {
  return listTrackedFiles()
    .filter((relPath) => !BINARY_EXTENSIONS.has(path.extname(relPath).toLowerCase()))
    .map((relPath) => path.join(REPO_ROOT, ...relPath.split('/')))
    .filter((fullPath) => fs.existsSync(fullPath) && fs.statSync(fullPath).isFile());
}

function scanFiles(files: string[]): ScannedFile[] {
  return files
    .map((file) => {
      const content = fs.readFileSync(file, 'utf-8');
      const relPath = path.relative(REPO_ROOT, file).split(path.sep).join('/');
      return { relPath, hits: findUnicodeFormatCharacters(content, relPath) };
    })
    .filter((scanned) => scanned.hits.length > 0);
}

function formatCodePoint(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
}

function formatFailure(scanned: ScannedFile[]): string {
  const hits = scanned.flatMap((file) => file.hits);
  const locations = hits
    .slice(0, MAX_REPORTED_HITS)
    .map((hit) => `  ${hit.relPath}:${hit.line}:${hit.column} — ${formatCodePoint(hit.codePoint)}`);

  if (hits.length > MAX_REPORTED_HITS) {
    locations.push(`  ...and ${hits.length - MAX_REPORTED_HITS} more`);
  }

  return [
    `Unicode format character${hits.length === 1 ? '' : 's'} found in tracked source:`,
    '',
    ...locations,
    '',
    'These invisible Unicode formatting characters can make source text misleading or alter its display.',
    'Remove the raw character from the tracked file. If the character is required at runtime, encode it',
    'as an escape or construct it in code rather than embedding the raw code point in source.',
    '',
    'See AGENTS.md § "Control characters in source".',
  ].join('\n');
}

describe('Tracked files contain no forbidden Unicode format characters', () => {
  const files = collectScannableFiles();

  it('should find source files to scan', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('should scan tracked files outside src/, not just src/', () => {
    const relPaths = files.map((file) => path.relative(REPO_ROOT, file).split(path.sep).join('/'));
    const outsideSrc = relPaths.filter((relPath) => !relPath.startsWith('src/'));

    expect(outsideSrc.some((relPath) => relPath.startsWith('pkg/'))).toBe(true);
    expect(outsideSrc.some((relPath) => !relPath.includes('/'))).toBe(true);
  });

  it('should have no forbidden Unicode format characters anywhere in the tracked tree', () => {
    const scanned = scanFiles(files);

    if (scanned.length > 0) {
      throw new Error(formatFailure(scanned));
    }
  });

  describe('detector', () => {
    it('should detect all forbidden Unicode format characters', () => {
      const content = FORBIDDEN_CODE_POINTS.map((codePoint) => String.fromCodePoint(codePoint)).join('');

      expect(findUnicodeFormatCharacters(content, 'example.ts')).toEqual(
        FORBIDDEN_CODE_POINTS.map((codePoint, index) => ({
          relPath: 'example.ts',
          line: 1,
          column: index + 1,
          codePoint,
        }))
      );
    });

    it('should count Unicode code points rather than UTF-16 units', () => {
      const content = `const s = '😀${String.fromCodePoint(0x200f)}';`;

      expect(findUnicodeFormatCharacters(content, 'example.ts')).toEqual([
        {
          relPath: 'example.ts',
          line: 1,
          column: 13,
          codePoint: 0x200f,
        },
      ]);
    });

    it('should report line and column for multiple violations', () => {
      const content = `const a = '${String.fromCodePoint(0x200b)}';\nconst b = '${String.fromCodePoint(0xfeff)}';`;

      expect(findUnicodeFormatCharacters(content, 'example.ts')).toEqual([
        {
          relPath: 'example.ts',
          line: 1,
          column: 12,
          codePoint: 0x200b,
        },
        {
          relPath: 'example.ts',
          line: 2,
          column: 12,
          codePoint: 0xfeff,
        },
      ]);
    });

    it('should not treat escaped Unicode sequences as raw format characters', () => {
      const content = String.raw`const mark = '\u200f';`;

      expect(findUnicodeFormatCharacters(content, 'example.ts')).toEqual([]);
    });
  });

  describe('failure message', () => {
    it('should identify the file, location, code point, and documentation', () => {
      const codePoint = 0x200f;
      const scanned: ScannedFile[] = [
        {
          relPath: 'example.ts',
          hits: [
            {
              relPath: 'example.ts',
              line: 3,
              column: 12,
              codePoint,
            },
          ],
        },
      ];

      const message = formatFailure(scanned);

      expect(message).toContain('example.ts:3:12');
      expect(message).toContain('U+200F');
      expect(message).toContain('AGENTS.md');
    });

    it('should report all distinct locations up to the configured limit', () => {
      const hits = Array.from({ length: MAX_REPORTED_HITS + 2 }, (_, index) => ({
        relPath: 'example.ts',
        line: index + 1,
        column: 1,
        codePoint: 0x200b,
      }));

      const message = formatFailure([{ relPath: 'example.ts', hits }]);

      expect(message).toContain('example.ts:1:1');
      expect(message).toContain(`example.ts:${MAX_REPORTED_HITS}:1`);
      expect(message).toContain(`...and 2 more`);
      expect(message).not.toContain(`example.ts:${MAX_REPORTED_HITS + 1}:1`);
    });
  });
});
