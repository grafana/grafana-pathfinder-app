export interface UnicodeFormatHit {
  relPath: string;
  line: number;
  column: number;
  codePoint: number;
}

const FORBIDDEN_UNICODE_FORMAT_CODE_POINTS = new Set([
  0x00ad, 0x200b, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2060, 0x2066, 0x2067, 0x2068, 0x2069,
  0xfeff,
]);

export function findUnicodeFormatCharacters(content: string, relPath: string): UnicodeFormatHit[] {
  const hits: UnicodeFormatHit[] = [];
  let line = 1;
  let column = 1;

  for (const character of content) {
    const codePoint = character.codePointAt(0);

    if (codePoint !== undefined && FORBIDDEN_UNICODE_FORMAT_CODE_POINTS.has(codePoint)) {
      hits.push({ relPath, line, column, codePoint });
    }

    if (character === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
  }

  return hits;
}
