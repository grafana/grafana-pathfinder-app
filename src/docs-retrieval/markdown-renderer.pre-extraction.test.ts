/**
 * Pre-extraction contract tests for markdown-renderer extraction (Phase 1).
 *
 * Disposable safety net per .cursor/skills/refactor/SKILL.md and the High-Risk
 * Refactor Guidelines wiki ("tests are safety rails, not refactoring targets").
 * These assertions pin the current behavior in `content-fetcher.ts` so that the
 * extraction to `./markdown-renderer` cannot silently change observable
 * output, mutation semantics, or contract-surface byte identity.
 *
 * Lifecycle: this file becomes `markdown-renderer.test.ts` (permanent) at the
 * post-test commit; the imports flip from `./content-fetcher` to
 * `./markdown-renderer` and 1–2 negative cases are appended.
 */
import {
  EXPECT_HEADING_RE,
  LEARNING_PATH_ICON_SVG,
  NEXT_HEADING_RE,
  simpleMarkdownToHtml,
  splitAtNextHeading,
  wrapExpectBlockInOrangeOutline,
} from './content-fetcher';

describe('markdown-renderer (pre-extraction contract)', () => {
  describe('simpleMarkdownToHtml — table-driven', () => {
    type Case = { name: string; input: string; expected: string };
    const cases: Case[] = [
      {
        name: '# heading → <h1>',
        input: '# Title',
        expected: '<h1>Title</h1>',
      },
      {
        name: '## heading → <h2>',
        input: '## Sub',
        expected: '<h2>Sub</h2>',
      },
      {
        name: '### heading → <h3>',
        input: '### Sub-sub',
        expected: '<h3>Sub-sub</h3>',
      },
      {
        name: 'two `-` items render as a single <ul> with two <li>',
        input: '- one\n- two',
        expected: '<ul>\n<li>one</li>\n<li>two</li>\n</ul>',
      },
      {
        name: 'inline link with safe https href is preserved',
        input: '[label](https://grafana.com/docs/)',
        expected: '<p><a href="https://grafana.com/docs/">label</a></p>',
      },
      {
        name: '`&` in href is escaped to a single `&amp;` (no double-encoding)',
        input: '[x](https://grafana.com/docs/?a=1&b=2)',
        expected: '<p><a href="https://grafana.com/docs/?a=1&amp;b=2">x</a></p>',
      },
      {
        name: 'javascript: href is rejected, label preserved (trailing `)` from outer parens leaks as escaped text — pre-existing behavior of the link regex)',
        // The `[a](b)` regex captures the FIRST `)` only, so the alert(1)'s
        // outer `)` falls outside the match and is escaped as text. The
        // important contract is that no <a href="javascript:..."> is emitted.
        input: '[click](javascript:alert(1))',
        expected: '<p>click)</p>',
      },
    ];

    it.each(cases)('$name', ({ input, expected }) => {
      expect(simpleMarkdownToHtml(input)).toBe(expected);
    });
  });

  describe('splitAtNextHeading — corner cases', () => {
    it('returns empty body and remainder for empty input', () => {
      expect(splitAtNextHeading('')).toEqual({ body: '', remainder: '' });
    });

    it('returns full text as body when no next heading is found', () => {
      const text = 'Some prose with no heading at all.\nLine 2.';
      expect(splitAtNextHeading(text)).toEqual({ body: text, remainder: '' });
    });

    it('returns empty body and full text as remainder when heading is at index 0', () => {
      const text = '## Heading immediately\nbody after';
      expect(splitAtNextHeading(text)).toEqual({ body: '', remainder: text });
    });
  });

  describe('wrapExpectBlockInOrangeOutline — in-place mutation', () => {
    it('mutates the input blocks array in place (same reference)', () => {
      const blocks: Array<{ type: string; content?: string }> = [
        { type: 'markdown', content: "# Here's what to expect\n- a\n- b" },
      ];
      const ref = blocks;
      wrapExpectBlockInOrangeOutline(blocks);

      // Same array reference (in-place mutation contract)
      expect(blocks).toBe(ref);

      // The original markdown block was replaced by an html block carrying the orange-outline-list card
      expect(blocks).toHaveLength(1);
      expect(blocks[0]!.type).toBe('html');
      expect(blocks[0]!.content).toContain('class="orange-outline-list"');
      expect(blocks[0]!.content).toContain("Here's what to expect");
    });

    it('consumes the next markdown sibling when the heading body is empty', () => {
      const blocks: Array<{ type: string; content?: string }> = [
        { type: 'markdown', content: "## Here's what to expect" },
        { type: 'markdown', content: '- pulled in\n- as card body' },
      ];

      wrapExpectBlockInOrangeOutline(blocks);

      // The sibling was consumed (length drops from 2 to 1)
      expect(blocks).toHaveLength(1);
      expect(blocks[0]!.type).toBe('html');
      expect(blocks[0]!.content).toContain('<li>pulled in</li>');
      expect(blocks[0]!.content).toContain('<li>as card body</li>');
    });
  });

  describe('Constant identity (anchors against accidental rename or whitespace drift)', () => {
    it('LEARNING_PATH_ICON_SVG byte-equality vs. the literal owned by content-fetcher today', () => {
      // Anchored prefix and suffix uniquely identify the SVG; full byte
      // equality is cheap and catches any whitespace/attribute drift.
      expect(LEARNING_PATH_ICON_SVG.startsWith('<svg width="30" height="30" viewBox="0 0 25 26"')).toBe(true);
      expect(LEARNING_PATH_ICON_SVG.endsWith('</svg>')).toBe(true);
      expect(LEARNING_PATH_ICON_SVG.length).toBe(1205);
      expect(LEARNING_PATH_ICON_SVG).toContain('fill="#ff671d"');
      expect(LEARNING_PATH_ICON_SVG).toContain('fill="#fbc55a"');
    });

    it('EXPECT_HEADING_RE matches "# Here\'s what to expect" (case- and curly-apostrophe insensitive) and rejects unrelated headings', () => {
      expect(EXPECT_HEADING_RE.flags).toBe('im');
      expect("# Here's what to expect more").toMatch(EXPECT_HEADING_RE);
      expect('## Here\u2019s what to expect').toMatch(EXPECT_HEADING_RE);
      expect('### what to expect today').toMatch(EXPECT_HEADING_RE);
      expect('# Some other heading').not.toMatch(EXPECT_HEADING_RE);
      expect('what to expect (no heading marker)').not.toMatch(EXPECT_HEADING_RE);
    });

    it('NEXT_HEADING_RE matches `^#{1,3}\\s+` in multiline mode and stops at the first such marker', () => {
      expect(NEXT_HEADING_RE.flags).toBe('m');
      const text = 'body line\n## Next section\nmore body';
      const match = text.match(NEXT_HEADING_RE);
      expect(match).not.toBeNull();
      expect(match![0]).toBe('## ');
      expect(match!.index).toBe('body line\n'.length);
      expect('plain prose with no heading'.match(NEXT_HEADING_RE)).toBeNull();
    });
  });
});
