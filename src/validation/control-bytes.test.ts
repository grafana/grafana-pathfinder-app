import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const GUARD_PATH = 'src/validation/control-bytes.test.ts';

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

// Source files carry a handful of stray bytes at most; binary blobs run orders of
// magnitude denser. Deriving this from content avoids a second hand-maintained
// list of "source" extensions alongside BINARY_EXTENSIONS. Density alone
// misjudges very short files, so a real blob must also clear an absolute count.
const BINARY_DENSITY_THRESHOLD = 0.01;
const BINARY_MIN_HITS = 32;

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

interface ScannedFile {
  relPath: string;
  byteLength: number;
  hits: ControlByteHit[];
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

function looksBinary(file: ScannedFile): boolean {
  if (file.byteLength === 0 || file.hits.length < BINARY_MIN_HITS) {
    return false;
  }
  return file.hits.length / file.byteLength >= BINARY_DENSITY_THRESHOLD;
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
      // Editors count columns in characters, not bytes. Control bytes are always
      // single-byte in UTF-8, so the prefix always ends on a character boundary.
      const column = content.subarray(lineStart, i).toString('utf-8').length + 1;
      hits.push({ relPath, line, column, byte });
    }
  }

  return hits;
}

function listTrackedFiles(): string[] {
  try {
    return execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 })
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
      const content = fs.readFileSync(file);
      const relPath = path.relative(REPO_ROOT, file).split(path.sep).join('/');
      return { relPath, byteLength: content.length, hits: findControlBytes(content, relPath) };
    })
    .filter((scanned) => scanned.hits.length > 0);
}

function formatBinarySection(binaryLike: ScannedFile[]): string[] {
  const rows = binaryLike.map((file) => {
    const percent = ((file.hits.length / file.byteLength) * 100).toFixed(1);
    const extension = path.extname(file.relPath).toLowerCase() || '(no extension)';
    return `  ${file.relPath} — ${file.hits.length} control bytes in ${file.byteLength} (${percent}%), extension ${extension}`;
  });

  return [
    'These tracked files look like binary assets rather than source:',
    '',
    ...rows,
    '',
    `If that is right, add the extension to BINARY_EXTENSIONS in ${GUARD_PATH} so the guard`,
    'skips it. If one of them is actually source, its raw bytes need escaping — see below.',
  ];
}

function formatSourceSection(sourceLike: ScannedFile[]): string[] {
  const hits = sourceLike.flatMap((file) => file.hits);
  const locations = hits
    .slice(0, MAX_REPORTED_HITS)
    .map((hit) => `  ${hit.relPath}:${hit.line}:${hit.column} — byte ${describeByte(hit.byte)}`);
  if (hits.length > MAX_REPORTED_HITS) {
    locations.push(`  ...and ${hits.length - MAX_REPORTED_HITS} more`);
  }

  const distinctBytes = [...new Set(hits.map((hit) => hit.byte))].sort((a, b) => a - b);
  const escapes = distinctBytes.map(escapeFor);
  const example = escapes[0] ?? escapeFor(0);

  return [
    `Raw control ${hits.length === 1 ? 'byte' : 'bytes'} found in tracked source:`,
    '',
    ...locations,
    '',
    'A single raw control byte makes the entire file look like a binary blob. `file` reports',
    'it as `data`, and `grep -r` / `rg` skip it silently unless forced with -a / --text. The',
    'search does not error or warn — it returns a *shorter* result set, which reads as "I have',
    'found everything". That trap produced a false bug report on this repo (#1519, since',
    'retracted); the failure class is documented in issue #1536.',
    '',
    `Fix: write each character as an escape instead of pasting the raw byte — here, ${escapes.join(', ')}.`,
    'An escape is the same character at runtime, and the file stays plain text:',
    '',
    `  const key = \`\${html}${example}\${baseUrl}\`;   // good`,
    '  const key = `${html}<raw byte>${baseUrl}`;  // bad — poisons the whole file',
    '',
    'If a test fixture genuinely needs the raw byte, build it in code with String.fromCharCode',
    'rather than embedding it in the source.',
    '',
    'Tab, newline, and carriage return are allowed. Everything else below 0x20, plus 0x7f, is',
    'not. See AGENTS.md § "Control characters in source".',
  ];
}

function formatFailure(scanned: ScannedFile[]): string {
  const binaryLike = scanned.filter(looksBinary);
  const sourceLike = scanned.filter((file) => !looksBinary(file));

  const sections: string[][] = [];
  if (binaryLike.length > 0) {
    sections.push(formatBinarySection(binaryLike));
  }
  if (sourceLike.length > 0) {
    sections.push(formatSourceSection(sourceLike));
  }

  return sections.map((section) => section.join('\n')).join('\n\n');
}

describe('Tracked files contain no raw control bytes', () => {
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

  it('should have no raw control bytes anywhere in the tracked tree', () => {
    const scanned = scanFiles(files);

    if (scanned.length > 0) {
      throw new Error(formatFailure(scanned));
    }
  });

  describe('detector', () => {
    it('should flag a NUL byte and report its position', () => {
      const content = Buffer.from(`const a = 1;\nconst b = '${String.fromCharCode(0)}';\n`, 'utf-8');

      expect(findControlBytes(content, 'example.ts')).toEqual([
        { relPath: 'example.ts', line: 2, column: 12, byte: 0 },
      ]);
    });

    it('should report the column in characters, not bytes', () => {
      const content = Buffer.from(`const s = 'ééé${String.fromCharCode(0)}';\n`, 'utf-8');

      expect(findControlBytes(content, 'example.ts')[0]?.column).toBe(15);
    });

    it('should flag other control bytes outside tab, newline, and carriage return', () => {
      const content = Buffer.from(String.fromCharCode(0x0b, 0x1b, 0x7f), 'utf-8');

      expect(findControlBytes(content, 'example.ts').map((hit) => hit.byte)).toEqual([0x0b, 0x1b, 0x7f]);
    });

    it('should allow tab, newline, and carriage return', () => {
      const content = Buffer.from('\tconst a = 1;\r\n', 'utf-8');

      expect(findControlBytes(content, 'example.ts')).toEqual([]);
    });
  });

  describe('failure message', () => {
    const sourceFile = (bytes: number[]): ScannedFile => ({
      relPath: 'example.ts',
      byteLength: 5000,
      hits: bytes.map((byte, i) => ({ relPath: 'example.ts', line: 1, column: i + 1, byte })),
    });

    it('should name the escape the author should have used', () => {
      const message = formatFailure([sourceFile([0])]);

      expect(message).toContain('example.ts:1:1');
      expect(message).toContain('0x00 (NUL)');
      expect(message).toContain('\\x00');
      expect(message).toContain('AGENTS.md');
      expect(message).toContain('#1536');
    });

    it('should name an escape for every distinct byte, not just the first', () => {
      const message = formatFailure([sourceFile([0x00, 0x1b])]);

      expect(message).toContain('\\x00');
      expect(message).toContain('\\x1b');
    });

    it('should tell the author to extend BINARY_EXTENSIONS for a dense binary asset', () => {
      const asset: ScannedFile = {
        relPath: 'src/img/mock.bmp',
        byteLength: 1000,
        hits: Array.from({ length: 500 }, (_, i) => ({ relPath: 'src/img/mock.bmp', line: 1, column: i + 1, byte: 0 })),
      };

      const message = formatFailure([asset]);

      expect(message).toContain('look like binary assets');
      expect(message).toContain('BINARY_EXTENSIONS');
      expect(message).toContain(GUARD_PATH);
      expect(message).toContain('.bmp');
      expect(message).not.toContain('poisons the whole file');
    });

    it('should keep the source guidance when a sparse stray byte is not asset-dense', () => {
      const message = formatFailure([sourceFile([0])]);

      expect(message).not.toContain('look like binary assets');
      expect(message).toContain('poisons the whole file');
    });

    it('should treat a short file with a couple of stray bytes as source, not an asset', () => {
      const shortFile: ScannedFile = {
        relPath: 'src/probe.ts',
        byteLength: 55,
        hits: [
          { relPath: 'src/probe.ts', line: 1, column: 24, byte: 0x00 },
          { relPath: 'src/probe.ts', line: 2, column: 21, byte: 0x1b },
        ],
      };

      const message = formatFailure([shortFile]);

      expect(message).not.toContain('look like binary assets');
      expect(message).toContain('src/probe.ts:1:24');
      expect(message).toContain('\\x1b');
    });
  });
});
