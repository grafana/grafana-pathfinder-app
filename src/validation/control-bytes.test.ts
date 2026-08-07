import * as fs from 'fs';
import * as path from 'path';

const SRC_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SRC_DIR, '..');

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

const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const DELETE = 0x7f;
const FIRST_PRINTABLE = 0x20;
const MAX_REPORTED_HITS = 20;

const CONTROL_BYTE_NAMES: Record<number, string> = {
  0x00: 'NUL',
  0x07: 'BEL',
  0x08: 'BS',
  0x0b: 'VT',
  0x0c: 'FF',
  0x1a: 'SUB',
  0x1b: 'ESC',
  0x7f: 'DEL',
};

interface ControlByteHit {
  relPath: string;
  line: number;
  column: number;
  byte: number;
}

function isDisallowedControlByte(byte: number): boolean {
  if (byte === TAB || byte === LINE_FEED || byte === CARRIAGE_RETURN) {
    return false;
  }
  return byte < FIRST_PRINTABLE || byte === DELETE;
}

function describeByte(byte: number): string {
  const hex = `0x${byte.toString(16).padStart(2, '0')}`;
  const name = CONTROL_BYTE_NAMES[byte];
  return name ? `${hex} (${name})` : hex;
}

function escapeFor(byte: number): string {
  return `\\x${byte.toString(16).padStart(2, '0')}`;
}

function findControlBytes(content: Buffer, relPath: string): ControlByteHit[] {
  const hits: ControlByteHit[] = [];
  let line = 1;
  let lineStart = 0;

  for (const [i, byte] of content.entries()) {
    if (byte === LINE_FEED) {
      line++;
      lineStart = i + 1;
      continue;
    }
    if (isDisallowedControlByte(byte)) {
      hits.push({ relPath, line, column: i - lineStart + 1, byte });
    }
  }

  return hits;
}

function collectScannableFiles(): string[] {
  const files: string[] = [];

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && !BINARY_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  }

  walk(SRC_DIR);
  return files;
}

function formatFailure(hits: ControlByteHit[]): string {
  const locations = hits
    .slice(0, MAX_REPORTED_HITS)
    .map((hit) => `  ${hit.relPath}:${hit.line}:${hit.column} — byte ${describeByte(hit.byte)}`);
  if (hits.length > MAX_REPORTED_HITS) {
    locations.push(`  ...and ${hits.length - MAX_REPORTED_HITS} more`);
  }
  const suggestion = escapeFor(hits[0]?.byte ?? 0);

  return [
    `Raw control ${hits.length === 1 ? 'byte' : 'bytes'} found in source under src/:`,
    '',
    ...locations,
    '',
    'A single raw control byte makes the entire file look like a binary blob. `file` reports',
    'it as `data`, and `grep -r` / `rg` skip it silently unless forced with -a / --text. The',
    'search does not error or warn — it returns a *shorter* result set, which reads as "I have',
    'found everything". That exact trap produced a false bug report on this repo (issue #1519):',
    'a symbol appeared to have a reader and no writer, because the file holding the writer was',
    'being skipped.',
    '',
    `Fix: write the character as an escape instead of pasting the raw byte. \`${suggestion}\` in a`,
    'TypeScript string or template literal is the same character at runtime, and the file stays',
    'plain text:',
    '',
    `  const key = \`\${html}${suggestion}\${baseUrl}\`;   // good`,
    '  const key = `${html}<raw byte>${baseUrl}`;  // bad — poisons the whole file',
    '',
    'If a test fixture genuinely needs the raw byte, build it in code with String.fromCharCode',
    'rather than embedding it in the source.',
    '',
    'Tab, newline, and carriage return are allowed. Everything else below 0x20, plus 0x7f, is not.',
  ].join('\n');
}

describe('Source files contain no raw control bytes', () => {
  const files = collectScannableFiles();

  it('should find source files to scan', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('should have no raw control bytes anywhere under src/', () => {
    const hits = files.flatMap((file) =>
      findControlBytes(fs.readFileSync(file), path.relative(REPO_ROOT, file).split(path.sep).join('/'))
    );

    if (hits.length > 0) {
      throw new Error(formatFailure(hits));
    }

    expect(hits).toEqual([]);
  });

  describe('detector', () => {
    it('should flag a NUL byte and report its position', () => {
      const content = Buffer.from(`const a = 1;\nconst b = '${String.fromCharCode(0)}';\n`, 'utf-8');

      expect(findControlBytes(content, 'example.ts')).toEqual([
        { relPath: 'example.ts', line: 2, column: 12, byte: 0 },
      ]);
    });

    it('should flag other control bytes outside tab, newline, and carriage return', () => {
      const content = Buffer.from(String.fromCharCode(0x0b, 0x1b, 0x7f), 'utf-8');

      expect(findControlBytes(content, 'example.ts').map((hit) => hit.byte)).toEqual([0x0b, 0x1b, 0x7f]);
    });

    it('should allow tab, newline, and carriage return', () => {
      const content = Buffer.from('\tconst a = 1;\r\n', 'utf-8');

      expect(findControlBytes(content, 'example.ts')).toEqual([]);
    });

    it('should name the escape the author should have used', () => {
      const message = formatFailure([{ relPath: 'example.ts', line: 1, column: 1, byte: 0 }]);

      expect(message).toContain('example.ts:1:1');
      expect(message).toContain('0x00 (NUL)');
      expect(message).toContain('\\x00');
    });
  });
});
