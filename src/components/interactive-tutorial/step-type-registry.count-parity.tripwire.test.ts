/**
 * Count-parity tripwire — pins the static step counter's block-type set
 * (`STEP_COUNTING_BLOCK_TYPES`, Tier 0) to the tracked step registry and
 * the JSON parser's emitted element types. A new step kind must land in
 * all three places or this fails.
 */

import { STEP_TYPE_SCHEMAS, STEP_TYPE_PARSE_KEYS } from './step-type-registry';
import { STEP_COUNTING_BLOCK_TYPES, type JsonBlock } from '../../types/json-guide.types';
import { countGuideSteps } from '../../docs-retrieval/count-guide-steps';
import { parseJsonGuide } from '../../docs-retrieval/json-parser';

const MINIMAL_BLOCK_BY_TYPE: Record<(typeof STEP_COUNTING_BLOCK_TYPES)[number], JsonBlock> = {
  interactive: { type: 'interactive', action: 'noop', content: 'read' },
  multistep: { type: 'multistep', content: 'multi', steps: [{ action: 'noop' }] },
  guided: { type: 'guided', content: 'guided', steps: [{ action: 'noop' }] },
  quiz: { type: 'quiz', question: 'q?', choices: [{ id: 'a', text: 'A', correct: true }] },
  terminal: { type: 'terminal', command: 'ls', content: 'run' },
  'terminal-connect': { type: 'terminal-connect', content: 'connect' },
  challenge: { type: 'challenge', title: 't', brief: 'b', successCriteria: 'is-admin' },
  'code-block': { type: 'code-block', reftarget: '.monaco', code: 'up' },
};

describe('step-count parity', () => {
  it('every registry schema jsonBlockType maps 1:1 onto STEP_COUNTING_BLOCK_TYPES', () => {
    const schemaBlockTypes = new Set(STEP_TYPE_SCHEMAS.map((s) => s.jsonBlockType));
    expect(schemaBlockTypes).toEqual(new Set(STEP_COUNTING_BLOCK_TYPES));
    expect(schemaBlockTypes.size).toBe(8);
    expect(STEP_TYPE_SCHEMAS).toHaveLength(8);
  });

  it('one minimal block per counting type parses into exactly the registry parse keys and counts 8', () => {
    const guide = {
      id: 'count-parity-fixture',
      title: 'Count parity fixture',
      blocks: STEP_COUNTING_BLOCK_TYPES.map((t) => MINIMAL_BLOCK_BY_TYPE[t]),
    };

    const result = parseJsonGuide(JSON.stringify(guide));
    expect(result.isValid).toBe(true);
    const emittedTypes = (result.data?.elements ?? []).map((el) => el.type).sort();
    expect(emittedTypes).toEqual([...STEP_TYPE_PARSE_KEYS].sort());

    expect(countGuideSteps(guide)).toBe(STEP_COUNTING_BLOCK_TYPES.length);
  });
});
