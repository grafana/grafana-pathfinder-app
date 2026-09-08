/**
 * Tests for static guide content analysis.
 *
 * countInteractiveBlocks lets the runner determine before Playwright starts
 * whether a guide has any interactive steps to execute. Markdown-only guides
 * should produce a 0-step pass rather than timing out waiting for DOM elements.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { countInteractiveBlocks, estimateGuideTimeoutFromContent } from './static-analysis';

const FIXTURES = join(__dirname, '../../fixtures');

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name, 'content.json'), 'utf-8');
}

describe('countInteractiveBlocks', () => {
  it('returns 0 for a markdown-only guide', () => {
    const json = loadFixture('markdown-only');
    expect(countInteractiveBlocks(JSON.parse(json))).toBe(0);
  });

  it('returns the correct count for a guide with interactive steps', () => {
    const json = loadFixture('always-passes');
    expect(countInteractiveBlocks(JSON.parse(json))).toBe(2);
  });

  it('counts every Pathfinder interactive block type', () => {
    const guide = {
      blocks: [
        { type: 'interactive' },
        { type: 'multistep' },
        { type: 'guided' },
        { type: 'quiz' },
        { type: 'input' },
        { type: 'code-block' },
        { type: 'terminal' },
        { type: 'terminal-connect' },
        { type: 'challenge' },
        { type: 'grot-guide' },
      ],
    };
    expect(countInteractiveBlocks(guide)).toBe(10);
  });

  it('treats a surviving snippet reference as potentially interactive', () => {
    expect(countInteractiveBlocks({ blocks: [{ type: 'snippet-ref' }] })).toBe(1);
  });

  it('counts interactive blocks nested inside conditional whenTrue and whenFalse', () => {
    const guide = {
      blocks: [
        {
          type: 'conditional',
          conditions: ['has-datasource:prometheus'],
          whenTrue: [{ type: 'interactive', action: 'highlight', reftarget: '.a', content: '' }],
          whenFalse: [{ type: 'interactive', action: 'button', reftarget: 'Set up', content: '' }],
        },
      ],
    };
    expect(countInteractiveBlocks(guide)).toBe(2);
  });

  it('counts interactive blocks nested inside assistant blocks', () => {
    const guide = {
      blocks: [
        {
          type: 'assistant',
          blocks: [{ type: 'interactive', action: 'highlight', reftarget: '.b', content: '' }],
        },
      ],
    };
    expect(countInteractiveBlocks(guide)).toBe(1);
  });

  it('returns 0 for an empty blocks array', () => {
    expect(countInteractiveBlocks({ blocks: [] })).toBe(0);
  });

  it('returns 0 for null and malformed guide values', () => {
    expect(countInteractiveBlocks(null)).toBe(0);
    expect(countInteractiveBlocks(undefined)).toBe(0);
    expect(countInteractiveBlocks('not-a-guide')).toBe(0);
  });

  it('counts deeply nested mixed content', () => {
    const guide = {
      blocks: [
        {
          type: 'section',
          blocks: [
            {
              type: 'assistant',
              blocks: [
                {
                  type: 'conditional',
                  whenTrue: [{ type: 'markdown' }, { type: 'guided' }],
                  whenFalse: [{ type: 'terminal' }],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(countInteractiveBlocks(guide)).toBe(2);
  });
});

describe('estimateGuideTimeoutFromContent', () => {
  it('adds the guided and multistep action budgets', () => {
    const content = JSON.stringify({
      blocks: [
        { type: 'guided', steps: [{}, {}] },
        { type: 'multistep', steps: [{}, {}, {}] },
      ],
    });

    expect(estimateGuideTimeoutFromContent(content)).toBe(453_000);
  });
});
