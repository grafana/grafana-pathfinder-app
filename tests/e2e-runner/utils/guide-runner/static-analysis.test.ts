/**
 * Tests for static guide content analysis.
 *
 * countInteractiveBlocks lets the runner determine before Playwright starts
 * whether a guide has any interactive steps to execute. Markdown-only guides
 * should produce a 0-step pass rather than timing out waiting for DOM elements.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { countInteractiveBlocks } from './static-analysis';

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
    // always-passes has 2 interactive blocks nested inside a section
    expect(countInteractiveBlocks(JSON.parse(json))).toBe(2);
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
});
