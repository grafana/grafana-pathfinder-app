/**
 * JSON Position Utilities Tests
 *
 * Tests for mapping JSON paths to line/column positions.
 */

import { parseWithPositions, addPositionsToErrors } from './json-position';

describe('parseWithPositions', () => {
  it('returns parse error with position for invalid JSON (missing comma)', () => {
    const result = parseWithPositions('{ "a": 1 "b": 2 }');
    expect(result.parseError).not.toBeNull();
    expect(result.parseError?.line).toBe(1);
    expect(result.parseError?.message).toContain('expected');
  });

  it('returns parse error with position for invalid JSON (missing closing brace)', () => {
    const result = parseWithPositions('{ "a": 1');
    expect(result.parseError).not.toBeNull();
    expect(result.parseError?.message).toContain('brace');
  });

  it('returns parse error with position for invalid JSON (invalid value)', () => {
    const result = parseWithPositions('{ invalid }');
    expect(result.parseError).not.toBeNull();
    expect(result.parseError?.line).toBe(1);
  });

  it('maps simple path to position (returns value position, not key)', () => {
    const json = `{
  "id": "test"
}`;
    // Note: jsonc-parser findNodeAtLocation returns the VALUE position, not the key
    // This is correct for error highlighting - we want to highlight the problematic value
    const result = parseWithPositions(json);
    expect(result.parseError).toBeNull();
    const pos = result.pathToPosition(['id']);
    // Line 2: `  "id": "test"` - value "test" starts at column 9
    expect(pos).toEqual({ line: 2, column: 9 });
  });

  it('maps nested path to position (returns value position)', () => {
    const json = `{
  "metadata": {
    "author": "test"
  }
}`;
    const result = parseWithPositions(json);
    expect(result.parseError).toBeNull();
    const pos = result.pathToPosition(['metadata', 'author']);
    // Line 3: `    "author": "test"` - value "test" starts at column 15
    expect(pos).toEqual({ line: 3, column: 15 });
  });

  it('maps array element path to position (returns value position)', () => {
    const json = `{
  "blocks": [
    { "type": "markdown" }
  ]
}`;
    const result = parseWithPositions(json);
    expect(result.parseError).toBeNull();
    const pos = result.pathToPosition(['blocks', 0, 'type']);
    // Line 3: `    { "type": "markdown" }` - value "markdown" starts at column 15
    expect(pos).toEqual({ line: 3, column: 15 });
  });

  it('maps deeply nested array path to position', () => {
    const json = `{
  "id": "test",
  "title": "Test Guide",
  "blocks": [
    {
      "type": "markdown",
      "content": "Hello"
    },
    {
      "type": "section",
      "title": "Section",
      "blocks": [
        {
          "type": "interactive",
          "content": "Click here"
        }
      ]
    }
  ]
}`;
    const result = parseWithPositions(json);
    expect(result.parseError).toBeNull();

    // blocks[0].type - value "markdown" is on line 6
    const pos1 = result.pathToPosition(['blocks', 0, 'type']);
    expect(pos1?.line).toBe(6);
    expect(pos1?.column).toBeGreaterThan(10); // After `"type": `

    // blocks[1].blocks[0].content - value "Click here" is on line 15
    const pos2 = result.pathToPosition(['blocks', 1, 'blocks', 0, 'content']);
    expect(pos2?.line).toBe(15);
    expect(pos2?.column).toBeGreaterThan(15); // After `"content": `
  });

  it('returns null for non-existent path', () => {
    const json = `{ "id": "test" }`;
    const result = parseWithPositions(json);
    expect(result.pathToPosition(['nonexistent'])).toBeNull();
    expect(result.pathToPosition(['id', 'nested'])).toBeNull();
    expect(result.pathToPosition(['blocks', 0])).toBeNull();
  });

  it('handles empty object', () => {
    const json = `{}`;
    const result = parseWithPositions(json);
    expect(result.parseError).toBeNull();
    expect(result.pathToPosition(['anything'])).toBeNull();
  });

  it('handles empty array', () => {
    const json = `{ "blocks": [] }`;
    const result = parseWithPositions(json);
    expect(result.parseError).toBeNull();
    expect(result.pathToPosition(['blocks'])).not.toBeNull();
    expect(result.pathToPosition(['blocks', 0])).toBeNull();
  });
});

describe('addPositionsToErrors', () => {
  it('enriches errors with line numbers', () => {
    const json = `{
  "blocks": [
    { "type": "invalid" }
  ]
}`;
    const errors = [{ message: 'Invalid type', path: ['blocks', 0, 'type'] }];
    const result = addPositionsToErrors(errors, json);
    expect(result).toHaveLength(1);
    expect(result[0].line).toBe(3);
    expect(result[0].message).toBe('Invalid type');
  });

  it('returns parse error when JSON is invalid', () => {
    const json = '{ invalid }';
    const errors = [{ message: 'Some error', path: ['id'] }];
    const result = addPositionsToErrors(errors, json);
    // Should return the parse error, not the validation error
    expect(result).toHaveLength(1);
    expect(result[0].line).toBe(1);
    expect(result[0].path).toEqual([]);
  });

  it('handles errors with paths that do not exist in JSON', () => {
    const json = `{ "id": "test" }`;
    const errors = [{ message: 'Missing field', path: ['blocks', 0, 'type'] }];
    const result = addPositionsToErrors(errors, json);
    expect(result).toHaveLength(1);
    expect(result[0].line).toBeUndefined();
    expect(result[0].message).toBe('Missing field');
  });

  it('enriches multiple errors with positions', () => {
    const json = `{
  "id": "test",
  "title": "",
  "blocks": []
}`;
    const errors = [
      { message: 'ID is reserved', path: ['id'] },
      { message: 'Title cannot be empty', path: ['title'] },
      { message: 'Blocks array is empty', path: ['blocks'] },
    ];
    const result = addPositionsToErrors(errors, json);
    expect(result).toHaveLength(3);
    expect(result[0].line).toBe(2);
    expect(result[1].line).toBe(3);
    expect(result[2].line).toBe(4);
  });
});

describe('performance', () => {
  it('parses large JSON in reasonable time', () => {
    // Generate a large guide with 100 blocks
    const blocks = Array.from({ length: 100 }, (_, i) => ({
      type: 'markdown',
      content: `Block ${i} content with some text to make it longer and more realistic for a real guide`,
    }));
    const largeGuide = {
      id: 'large-guide',
      title: 'Large Guide for Performance Testing',
      blocks,
    };
    const json = JSON.stringify(largeGuide, null, 2);

    // Should parse in under 50ms (conservative threshold)
    const start = performance.now();
    const result = parseWithPositions(json);
    const elapsed = performance.now() - start;

    expect(result.parseError).toBeNull();
    expect(elapsed).toBeLessThan(50);

    // Also verify path mapping works
    const pos = result.pathToPosition(['blocks', 50, 'content']);
    expect(pos).not.toBeNull();
    expect(pos?.line).toBeGreaterThan(50);
  });
});
