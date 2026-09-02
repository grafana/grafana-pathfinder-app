import { findUnicodeFormatCharacters } from './unicode-format-characters';

const FORBIDDEN_CODE_POINTS = [
  0x00ad,
  0x200b,
  0x200e,
  0x200f,
  0x202a,
  0x202b,
  0x202c,
  0x202d,
  0x202e,
  0x2060,
  0x2066,
  0x2067,
  0x2068,
  0x2069,
  0xfeff,
];

describe('Unicode format character detector', () => {
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
