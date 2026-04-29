import { normalizeCodeIndentation } from './normalizeCodeIndentation';

describe('normalizeCodeIndentation', () => {
  it('leaves a flat (no-indent) fence unchanged', () => {
    const input = ['```js', 'const x = 1;', '```'].join('\n');
    expect(normalizeCodeIndentation(input)).toBe(input);
  });

  it('re-aligns fence markers to match 3-space content indent (the reported bug)', () => {
    // TipTap strips the 3-space indent from fence markers but leaves content indented
    const input = ['1. FIRST', '```', '   FENCED CODE', '```', '2. SECOND', '3. THIRD'].join('\n');

    const expected = ['1. FIRST', '   ```', '   FENCED CODE', '   ```', '2. SECOND', '3. THIRD'].join('\n');

    expect(normalizeCodeIndentation(input)).toBe(expected);
  });

  it('does NOT re-align flat fences when content is indented 4+ spaces (would violate CommonMark)', () => {
    // CommonMark specifies fence markers can only have 0-3 spaces of indentation.
    // A flat code block with deeply indented content (e.g., pasted from inside a
    // class/function) must NOT have its fence markers indented to match, as 4+
    // spaces would cause the fence line to be parsed as an indented code block.
    const input = ['```', '      DEEP CODE', '```'].join('\n');
    expect(normalizeCodeIndentation(input)).toBe(input);
  });

  it('handles tilde fences', () => {
    const input = ['~~~', '   content here', '~~~'].join('\n');
    const expected = ['   ~~~', '   content here', '   ~~~'].join('\n');
    expect(normalizeCodeIndentation(input)).toBe(expected);
  });

  it('fixes nested fence while leaving a flat fence unchanged in the same document', () => {
    const input = ['```', 'flat code', '```', '', '1. item', '```', '   nested code', '```'].join('\n');

    const expected = ['```', 'flat code', '```', '', '1. item', '   ```', '   nested code', '   ```'].join('\n');

    expect(normalizeCodeIndentation(input)).toBe(expected);
  });

  it('skips blank lines to detect first non-blank content indent', () => {
    const input = ['```', '', '   first real line', '```'].join('\n');
    const expected = ['   ```', '', '   first real line', '   ```'].join('\n');
    expect(normalizeCodeIndentation(input)).toBe(expected);
  });

  it('is a no-op when the fence body is entirely blank', () => {
    const input = ['```', '', '```'].join('\n');
    expect(normalizeCodeIndentation(input)).toBe(input);
  });

  it('preserves the fence info string (language tag)', () => {
    const input = ['```javascript', '   const x = 1;', '```'].join('\n');
    const expected = ['   ```javascript', '   const x = 1;', '   ```'].join('\n');
    expect(normalizeCodeIndentation(input)).toBe(expected);
  });

  it('is idempotent — already-correct Markdown passes through unchanged', () => {
    const input = ['1. FIRST', '   ```', '   FENCED CODE', '   ```', '2. SECOND'].join('\n');
    expect(normalizeCodeIndentation(input)).toBe(input);
  });

  it('uses the minimum content indent, not the first line, when the code itself is internally indented', () => {
    // The first content line is indented 6 spaces (deeper than the list
    // continuation), but a later line sits at the true list continuation
    // indent of 3 spaces. The fence markers must align to 3, not 6, so the
    // shallower line stays inside the fence.
    const input = ['1. FIRST', '```', '      if (x) {', '         doStuff();', '      }', '   trailing()', '```'].join(
      '\n'
    );

    const expected = [
      '1. FIRST',
      '   ```',
      '      if (x) {',
      '         doStuff();',
      '      }',
      '   trailing()',
      '   ```',
    ].join('\n');

    expect(normalizeCodeIndentation(input)).toBe(expected);
  });

  it('picks the minimum indent even when blank lines appear before the shallowest line', () => {
    const input = ['```', '      deep_first', '', '   shallow_later', '```'].join('\n');
    const expected = ['   ```', '      deep_first', '', '   shallow_later', '   ```'].join('\n');
    expect(normalizeCodeIndentation(input)).toBe(expected);
  });
});
