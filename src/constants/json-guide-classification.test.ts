import { INTERACTIVE_BLOCK_TYPES, isInteractiveBlockType } from './json-guide-classification';

describe('JSON guide classification', () => {
  it('defines every Pathfinder interactive block type', () => {
    expect(INTERACTIVE_BLOCK_TYPES).toEqual([
      'interactive',
      'multistep',
      'guided',
      'quiz',
      'input',
      'terminal',
      'terminal-connect',
      'code-block',
      'challenge',
      'grot-guide',
    ]);
  });

  it('distinguishes interactive blocks from content and containers', () => {
    expect(isInteractiveBlockType('quiz')).toBe(true);
    expect(isInteractiveBlockType('code-block')).toBe(true);
    expect(isInteractiveBlockType('markdown')).toBe(false);
    expect(isInteractiveBlockType('section')).toBe(false);
    expect(isInteractiveBlockType('conditional')).toBe(false);
    expect(isInteractiveBlockType('snippet-ref')).toBe(false);
  });
});
