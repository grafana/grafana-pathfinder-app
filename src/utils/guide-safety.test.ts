/**
 * Tests for isMainAreaSafe() guide safety classification.
 *
 * Validates that guides with DOM-targeting interactive actions (highlight,
 * button, formfill, hover) are classified as unsafe for main-area rendering,
 * while guides with safe actions (noop, navigate) or no interactive elements
 * are classified as safe.
 */

import { isMainAreaSafe } from './guide-safety';

function makeGuide(blocks: any[]): string {
  return JSON.stringify({ id: 'test-guide', title: 'Test', blocks });
}

describe('isMainAreaSafe', () => {
  // --- Safe guides -----------------------------------------------------------

  it('classifies guide with only noop actions as safe', () => {
    const result = isMainAreaSafe(makeGuide([{ type: 'interactive', action: 'noop', content: 'Step 1' }]));
    expect(result.safe).toBe(true);
    expect(result.unsafeActionTypes).toEqual([]);
  });

  it('classifies guide with only navigate actions as safe', () => {
    const result = isMainAreaSafe(
      makeGuide([{ type: 'interactive', action: 'navigate', content: 'Go to dashboards' }])
    );
    expect(result.safe).toBe(true);
  });

  it('classifies navigate with openGuide as safe', () => {
    const result = isMainAreaSafe(
      makeGuide([
        {
          type: 'interactive',
          action: 'navigate',
          content: 'Open next guide',
          openGuide: 'bundled:next-guide',
        },
      ])
    );
    expect(result.safe).toBe(true);
  });

  it('classifies empty blocks array as safe', () => {
    const result = isMainAreaSafe(makeGuide([]));
    expect(result.safe).toBe(true);
    expect(result.unsafeActionTypes).toEqual([]);
  });

  it('classifies quiz-only guide as safe', () => {
    const result = isMainAreaSafe(
      makeGuide([
        {
          type: 'quiz',
          question: 'What is Grafana?',
          choices: [{ text: 'A monitoring tool', correct: true }],
        },
      ])
    );
    expect(result.safe).toBe(true);
  });

  it('classifies terminal-only guide as safe', () => {
    const result = isMainAreaSafe(makeGuide([{ type: 'terminal', command: 'echo hello', content: 'Run this' }]));
    expect(result.safe).toBe(true);
  });

  it('classifies markdown-only guide as safe', () => {
    const result = isMainAreaSafe(makeGuide([{ type: 'markdown', content: '# Hello world' }]));
    expect(result.safe).toBe(true);
  });

  it('treats non-JSON content as safe', () => {
    const result = isMainAreaSafe('<h1>Some HTML</h1>');
    expect(result.safe).toBe(true);
    expect(result.unsafeActionTypes).toEqual([]);
  });

  it('treats content without blocks array as safe', () => {
    const result = isMainAreaSafe(JSON.stringify({ id: 'no-blocks', title: 'Test' }));
    expect(result.safe).toBe(true);
  });

  // --- Unsafe guides ---------------------------------------------------------

  it('classifies guide with highlight action as unsafe', () => {
    const result = isMainAreaSafe(
      makeGuide([{ type: 'interactive', action: 'highlight', reftarget: '#some-element', content: 'Look here' }])
    );
    expect(result.safe).toBe(false);
    expect(result.unsafeActionTypes).toEqual(['highlight']);
  });

  it('classifies guide with button action as unsafe', () => {
    const result = isMainAreaSafe(
      makeGuide([{ type: 'interactive', action: 'button', reftarget: '#submit-btn', content: 'Click this' }])
    );
    expect(result.safe).toBe(false);
    expect(result.unsafeActionTypes).toEqual(['button']);
  });

  it('classifies guide with formfill action as unsafe', () => {
    const result = isMainAreaSafe(
      makeGuide([
        {
          type: 'interactive',
          action: 'formfill',
          reftarget: '#name-input',
          targetvalue: 'test',
          content: 'Fill this',
        },
      ])
    );
    expect(result.safe).toBe(false);
    expect(result.unsafeActionTypes).toEqual(['formfill']);
  });

  it('classifies guide with hover action as unsafe', () => {
    const result = isMainAreaSafe(
      makeGuide([{ type: 'interactive', action: 'hover', reftarget: '#menu', content: 'Hover here' }])
    );
    expect(result.safe).toBe(false);
    expect(result.unsafeActionTypes).toEqual(['hover']);
  });

  it('classifies mixed guide (safe + unsafe steps) as unsafe', () => {
    const result = isMainAreaSafe(
      makeGuide([
        { type: 'interactive', action: 'noop', content: 'Safe step' },
        { type: 'interactive', action: 'highlight', reftarget: '#el', content: 'Unsafe step' },
      ])
    );
    expect(result.safe).toBe(false);
    expect(result.unsafeActionTypes).toEqual(['highlight']);
  });

  it('collects multiple unsafe action types', () => {
    const result = isMainAreaSafe(
      makeGuide([
        { type: 'interactive', action: 'highlight', reftarget: '#a', content: 'Step 1' },
        { type: 'interactive', action: 'button', reftarget: '#b', content: 'Step 2' },
        { type: 'interactive', action: 'formfill', reftarget: '#c', targetvalue: 'x', content: 'Step 3' },
      ])
    );
    expect(result.safe).toBe(false);
    expect(result.unsafeActionTypes).toContain('highlight');
    expect(result.unsafeActionTypes).toContain('button');
    expect(result.unsafeActionTypes).toContain('formfill');
  });

  // --- showMe/doIt flags don't affect classification -------------------------

  it('classifies step with showMe:false and doIt:false but unsafe action as unsafe', () => {
    const result = isMainAreaSafe(
      makeGuide([
        {
          type: 'interactive',
          action: 'button',
          reftarget: '#btn',
          content: 'Hidden buttons',
          showMe: false,
          doIt: false,
        },
      ])
    );
    expect(result.safe).toBe(false);
    expect(result.unsafeActionTypes).toEqual(['button']);
  });

  // --- Multistep blocks ------------------------------------------------------

  it('classifies multistep block with unsafe step actions as unsafe', () => {
    const result = isMainAreaSafe(
      makeGuide([
        {
          type: 'multistep',
          content: 'Automated sequence',
          steps: [
            { action: 'button', reftarget: '#btn1' },
            { action: 'formfill', reftarget: '#input1', targetvalue: 'val' },
          ],
        },
      ])
    );
    expect(result.safe).toBe(false);
    expect(result.unsafeActionTypes).toContain('button');
    expect(result.unsafeActionTypes).toContain('formfill');
  });

  it('classifies multistep block with only noop steps as safe', () => {
    const result = isMainAreaSafe(
      makeGuide([
        {
          type: 'multistep',
          content: 'Safe sequence',
          steps: [{ action: 'noop' }, { action: 'navigate' }],
        },
      ])
    );
    expect(result.safe).toBe(true);
  });

  // --- Guided blocks ---------------------------------------------------------

  it('classifies guided block with unsafe step actions as unsafe', () => {
    const result = isMainAreaSafe(
      makeGuide([
        {
          type: 'guided',
          content: 'User-performed steps',
          steps: [
            { action: 'hover', reftarget: '#menu' },
            { action: 'button', reftarget: '#item' },
          ],
        },
      ])
    );
    expect(result.safe).toBe(false);
    expect(result.unsafeActionTypes).toContain('hover');
    expect(result.unsafeActionTypes).toContain('button');
  });

  // --- Nested blocks (sections) ----------------------------------------------

  it('classifies unsafe action inside a section block as unsafe', () => {
    const result = isMainAreaSafe(
      makeGuide([
        {
          type: 'section',
          title: 'Setup',
          blocks: [
            { type: 'interactive', action: 'noop', content: 'Safe' },
            { type: 'interactive', action: 'highlight', reftarget: '#el', content: 'Unsafe' },
          ],
        },
      ])
    );
    expect(result.safe).toBe(false);
    expect(result.unsafeActionTypes).toEqual(['highlight']);
  });

  it('classifies deeply nested unsafe action as unsafe', () => {
    const result = isMainAreaSafe(
      makeGuide([
        {
          type: 'section',
          title: 'Outer',
          blocks: [
            {
              type: 'section',
              title: 'Inner',
              blocks: [{ type: 'interactive', action: 'formfill', reftarget: '#el', content: 'Deep' }],
            },
          ],
        },
      ])
    );
    expect(result.safe).toBe(false);
  });

  // --- Conditional blocks ----------------------------------------------------

  it('classifies unsafe action in conditional passBlocks as unsafe', () => {
    const result = isMainAreaSafe(
      makeGuide([
        {
          type: 'conditional',
          condition: 'some-check',
          passBlocks: [{ type: 'interactive', action: 'button', reftarget: '#btn', content: 'Click' }],
          failBlocks: [{ type: 'interactive', action: 'noop', content: 'Safe' }],
        },
      ])
    );
    expect(result.safe).toBe(false);
  });

  it('classifies unsafe action in conditional failBlocks as unsafe', () => {
    const result = isMainAreaSafe(
      makeGuide([
        {
          type: 'conditional',
          condition: 'some-check',
          passBlocks: [{ type: 'interactive', action: 'noop', content: 'Safe' }],
          failBlocks: [{ type: 'interactive', action: 'hover', reftarget: '#el', content: 'Unsafe' }],
        },
      ])
    );
    expect(result.safe).toBe(false);
  });
});
