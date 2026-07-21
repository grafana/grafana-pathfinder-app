import { STEP_TYPE_SCHEMAS, STEP_TYPE_PARSE_KEYS } from './step-type-registry';
import { STEP_COUNTING_BLOCK_TYPES, type JsonBlock, type StepCountingBlockType } from '../../types/json-guide.types';
import { countGuideSteps } from '../../docs-retrieval/count-guide-steps';
import { parseJsonGuide } from '../../docs-retrieval/json-parser';

const MINIMAL_BLOCK_BY_TYPE: { [K in StepCountingBlockType]: Extract<JsonBlock, { type: K }> } = {
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

  it.each(STEP_TYPE_SCHEMAS)('$jsonBlockType parses as $parseTypeKey and counts as one step', (schema) => {
    const block = MINIMAL_BLOCK_BY_TYPE[schema.jsonBlockType];
    const guide = { id: 'mapping-fixture', title: 'Mapping fixture', blocks: [block] };

    const result = parseJsonGuide(JSON.stringify(guide));
    expect(result.isValid).toBe(true);
    expect(result.data?.elements.map((element) => element.type)).toEqual([schema.parseTypeKey]);
    expect(countGuideSteps(guide)).toBe(1);
  });
});
