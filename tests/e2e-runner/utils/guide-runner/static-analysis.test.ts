/**
 * Tests for static guide content analysis.
 *
 * countDiscoverableSteps lets the runner determine before Playwright starts
 * whether a guide has any interactive steps to execute. Markdown-only guides
 * should produce a 0-step pass rather than timing out waiting for DOM elements.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { countDiscoverableSteps } from './static-analysis';

const FIXTURES = join(__dirname, '../../fixtures');

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name, 'content.json'), 'utf-8');
}

describe('countDiscoverableSteps', () => {
  it('returns 0 for a markdown-only guide', () => {
    const json = loadFixture('markdown-only');
    expect(countDiscoverableSteps(JSON.parse(json))).toBe(0);
  });

  it('returns the correct count for a guide with interactive steps', () => {
    const json = loadFixture('always-passes');
    expect(countDiscoverableSteps(JSON.parse(json))).toBe(2);
  });

  it('counts all E2E-discoverable block types and excludes unsupported block types', () => {
    const guide = {
      blocks: [
        { type: 'interactive' },
        { type: 'multistep' },
        { type: 'guided' },
        { type: 'code-block' },
        { type: 'terminal' },
        { type: 'terminal-connect' },
        { type: 'grot-guide' },
      ],
    };
    expect(countDiscoverableSteps(guide)).toBe(3);
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
    expect(countDiscoverableSteps(guide)).toBe(2);
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
    expect(countDiscoverableSteps(guide)).toBe(1);
  });

  it('returns 0 for an empty blocks array', () => {
    expect(countDiscoverableSteps({ blocks: [] })).toBe(0);
  });

  it('returns 0 for null and malformed guide values', () => {
    expect(countDiscoverableSteps(null)).toBe(0);
    expect(countDiscoverableSteps(undefined)).toBe(0);
    expect(countDiscoverableSteps('not-a-guide')).toBe(0);
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
    expect(countDiscoverableSteps(guide)).toBe(1);
  });
});
