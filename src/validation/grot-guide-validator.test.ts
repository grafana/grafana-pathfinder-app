import type { JsonGrotGuideBlock, JsonGuide } from '../types/json-guide.types';
import { validateGrotGuideBlock, validateGrotGuideGraphs } from './grot-guide-validator';

describe('Grot Guide Validator', () => {
  describe('clean graph', () => {
    it('accepts a valid branching grot-guide with no issues', () => {
      const block: JsonGrotGuideBlock = {
        type: 'grot-guide',
        welcome: {
          title: 'Welcome',
          body: 'Choose your journey',
          ctas: [
            { text: 'Start A', screenId: 'q1' },
            { text: 'Fast Track', screenId: 'r1' },
          ],
        },
        screens: [
          {
            type: 'question',
            id: 'q1',
            title: 'Which stack?',
            options: [
              { text: 'Cloud', screenId: 'r1' },
              { text: 'OSS', screenId: 'r2' },
            ],
          },
          {
            type: 'result',
            id: 'r1',
            title: 'Cloud Result',
            body: 'Cloud docs',
            links: [{ title: 'Docs', linkText: 'Read Cloud Docs', href: 'https://grafana.com/docs' }],
          },
          {
            type: 'result',
            id: 'r2',
            title: 'OSS Result',
            body: 'OSS docs',
            links: [{ title: 'Docs', linkText: 'Read OSS Docs', href: 'https://grafana.com/docs' }],
          },
        ],
      };

      const issues = validateGrotGuideBlock(block, ['blocks', 0]);
      expect(issues).toHaveLength(0);
    });

    it('stays silent on cycles that have an escape edge to a result', () => {
      const block: JsonGrotGuideBlock = {
        type: 'grot-guide',
        welcome: {
          title: 'Welcome',
          body: 'Start',
          ctas: [{ text: 'Go', screenId: 'q1' }],
        },
        screens: [
          {
            type: 'question',
            id: 'q1',
            title: 'Step 1',
            options: [
              { text: 'Next', screenId: 'q2' },
              { text: 'Direct to result', screenId: 'r1' },
            ],
          },
          {
            type: 'question',
            id: 'q2',
            title: 'Step 2',
            options: [
              { text: 'Go back to step 1', screenId: 'q1' },
              { text: 'Finish', screenId: 'r1' },
            ],
          },
          {
            type: 'result',
            id: 'r1',
            title: 'Result',
            body: 'Done',
            links: [{ title: 'Docs', linkText: 'Read', href: '/docs' }],
          },
        ],
      };

      const issues = validateGrotGuideBlock(block, ['blocks', 0]);
      expect(issues).toHaveLength(0);
    });
  });

  describe('defect codes', () => {
    it('reports duplicate_screen_id as a warning', () => {
      const block: JsonGrotGuideBlock = {
        type: 'grot-guide',
        welcome: {
          title: 'Welcome',
          body: 'Start',
          ctas: [{ text: 'Go', screenId: 'dup' }],
        },
        screens: [
          {
            type: 'result',
            id: 'dup',
            title: 'First',
            body: 'First body',
            links: [{ title: 'Docs', linkText: 'Read', href: '/docs' }],
          },
          {
            type: 'result',
            id: 'dup',
            title: 'Second',
            body: 'Second body',
            links: [{ title: 'Docs', linkText: 'Read', href: '/docs' }],
          },
        ],
      };

      const issues = validateGrotGuideBlock(block, ['blocks', 0]);
      const duplicates = issues.filter((i) => i.code === 'duplicate_screen_id');
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0]?.severity).toBe('warning');
      expect(duplicates[0]?.path).toEqual(['blocks', 0, 'screens', 1, 'id']);
    });

    it('reports self_loop as an error when an option points to its own screen', () => {
      const block: JsonGrotGuideBlock = {
        type: 'grot-guide',
        welcome: {
          title: 'Welcome',
          body: 'Start',
          ctas: [{ text: 'Go', screenId: 'q1' }],
        },
        screens: [
          {
            type: 'question',
            id: 'q1',
            title: 'Question 1',
            options: [
              { text: 'Reload self', screenId: 'q1' },
              { text: 'Finish', screenId: 'r1' },
            ],
          },
          {
            type: 'result',
            id: 'r1',
            title: 'Result',
            body: 'Done',
            links: [{ title: 'Docs', linkText: 'Read', href: '/docs' }],
          },
        ],
      };

      const issues = validateGrotGuideBlock(block, ['blocks', 0]);
      const selfLoops = issues.filter((i) => i.code === 'self_loop');
      expect(selfLoops).toHaveLength(1);
      expect(selfLoops[0]?.severity).toBe('error');
      expect(selfLoops[0]?.path).toEqual(['blocks', 0, 'screens', 0, 'options', 0, 'screenId']);
    });

    it('reports unreachable_screen as a warning for screens not reached from welcome', () => {
      const block: JsonGrotGuideBlock = {
        type: 'grot-guide',
        welcome: {
          title: 'Welcome',
          body: 'Start',
          ctas: [{ text: 'Go', screenId: 'r1' }],
        },
        screens: [
          {
            type: 'result',
            id: 'r1',
            title: 'Result',
            body: 'Done',
            links: [{ title: 'Docs', linkText: 'Read', href: '/docs' }],
          },
          {
            type: 'question',
            id: 'orphan-q',
            title: 'Orphan question',
            options: [{ text: 'To orphan r', screenId: 'orphan-r' }],
          },
          {
            type: 'result',
            id: 'orphan-r',
            title: 'Orphan result',
            body: 'Done',
            links: [{ title: 'Docs', linkText: 'Read', href: '/docs' }],
          },
        ],
      };

      const issues = validateGrotGuideBlock(block, ['blocks', 0]);
      const unreachable = issues.filter((i) => i.code === 'unreachable_screen');
      expect(unreachable).toHaveLength(2);
      expect(unreachable.map((u) => u.path)).toEqual([
        ['blocks', 0, 'screens', 1],
        ['blocks', 0, 'screens', 2],
      ]);
      expect(unreachable.every((u) => u.severity === 'warning')).toBe(true);
    });

    it('reports no_result_path as an error when reachable questions cannot reach any result', () => {
      const block: JsonGrotGuideBlock = {
        type: 'grot-guide',
        welcome: {
          title: 'Welcome',
          body: 'Start',
          ctas: [{ text: 'Go', screenId: 'dead1' }],
        },
        screens: [
          {
            type: 'question',
            id: 'dead1',
            title: 'Dead 1',
            options: [{ text: 'To dead 2', screenId: 'dead2' }],
          },
          {
            type: 'question',
            id: 'dead2',
            title: 'Dead 2',
            options: [{ text: 'To dead 1', screenId: 'dead1' }],
          },
          {
            type: 'result',
            id: 'disconnected-result',
            title: 'Result',
            body: 'Done',
            links: [{ title: 'Docs', linkText: 'Read', href: '/docs' }],
          },
        ],
      };

      const issues = validateGrotGuideBlock(block, ['blocks', 0]);
      const noResult = issues.filter((i) => i.code === 'no_result_path');
      expect(noResult).toHaveLength(2);
      expect(noResult.every((e) => e.severity === 'error')).toBe(true);
      expect(noResult.map((e) => e.path)).toEqual([
        ['blocks', 0, 'screens', 0],
        ['blocks', 0, 'screens', 1],
      ]);
    });

    it('reports empty_result as a warning when a reachable result has no links', () => {
      const block: JsonGrotGuideBlock = {
        type: 'grot-guide',
        welcome: {
          title: 'Welcome',
          body: 'Start',
          ctas: [{ text: 'Go', screenId: 'r-empty' }],
        },
        screens: [
          {
            type: 'result',
            id: 'r-empty',
            title: 'Empty links',
            body: 'No links here',
            links: [],
          },
        ],
      };

      const issues = validateGrotGuideBlock(block, ['blocks', 0]);
      const emptyResults = issues.filter((i) => i.code === 'empty_result');
      expect(emptyResults).toHaveLength(1);
      expect(emptyResults[0]?.severity).toBe('warning');
      expect(emptyResults[0]?.path).toEqual(['blocks', 0, 'screens', 0]);
    });

    it('does not report empty_result on unreachable result screens', () => {
      const block: JsonGrotGuideBlock = {
        type: 'grot-guide',
        welcome: {
          title: 'Welcome',
          body: 'Start',
          ctas: [{ text: 'Go', screenId: 'r-valid' }],
        },
        screens: [
          {
            type: 'result',
            id: 'r-valid',
            title: 'Valid',
            body: 'Has links',
            links: [{ title: 'Docs', linkText: 'Read', href: '/docs' }],
          },
          {
            type: 'result',
            id: 'r-unreachable-empty',
            title: 'Empty and unreachable',
            body: 'No links',
            links: [],
          },
        ],
      };

      const issues = validateGrotGuideBlock(block, ['blocks', 0]);
      const emptyResults = issues.filter((i) => i.code === 'empty_result');
      expect(emptyResults).toHaveLength(0);
      const unreachable = issues.filter((i) => i.code === 'unreachable_screen');
      expect(unreachable).toHaveLength(1);
    });
  });

  describe('validateGrotGuideGraphs full guide traversal', () => {
    it('traverses nested blocks within sections and conditionals', () => {
      const guide: JsonGuide = {
        id: 'nested-guide',
        title: 'Nested Guide',
        blocks: [
          {
            type: 'section',
            title: 'Section 1',
            blocks: [
              {
                type: 'grot-guide',
                welcome: {
                  title: 'W',
                  body: 'B',
                  ctas: [{ text: 'Go', screenId: 'r1' }],
                },
                screens: [
                  {
                    type: 'result',
                    id: 'r1',
                    title: 'R1',
                    body: 'Done',
                    links: [{ title: 'Doc', linkText: 'Read', href: '/docs' }],
                  },
                  {
                    type: 'result',
                    id: 'unreachable-in-section',
                    title: 'Orphan',
                    body: 'Never seen',
                    links: [{ title: 'Doc', linkText: 'Read', href: '/docs' }],
                  },
                ],
              },
            ],
          },
          {
            type: 'conditional',
            conditions: ['is-admin'],
            whenTrue: [
              {
                type: 'grot-guide',
                welcome: {
                  title: 'W',
                  body: 'B',
                  ctas: [{ text: 'Go', screenId: 'r-empty' }],
                },
                screens: [
                  {
                    type: 'result',
                    id: 'r-empty',
                    title: 'Empty links',
                    body: 'No links',
                  },
                ],
              },
            ],
            whenFalse: [],
          },
        ],
      };

      const issues = validateGrotGuideGraphs(guide);
      expect(issues).toHaveLength(2);
      expect(issues[0]?.code).toBe('unreachable_screen');
      expect(issues[0]?.path).toEqual(['blocks', 0, 'blocks', 0, 'screens', 1]);
      expect(issues[1]?.code).toBe('empty_result');
      expect(issues[1]?.path).toEqual(['blocks', 1, 'whenTrue', 0, 'screens', 0]);
    });
  });
});
