import {
  JsonInputBlockSchema,
  JsonBlockSchema,
  JsonBlockSchemaNoRef,
  JsonSectionBlockSchema,
} from '../types/json-guide.schema';
import { validateGuide } from './validate-guide';

const input = {
  type: 'input',
  inputType: 'checkbox-group',
  prompt: 'Which environments?',
  variableName: 'environments',
  choices: [{ id: 'production', text: 'Production' }],
};

it('accepts checkbox groups and preserves option IDs', () => {
  expect(JsonInputBlockSchema.parse(input)).toEqual(input);
});

it.each([
  { choices: [] },
  { choices: [{ id: 'bad,id', text: 'Bad' }] },
  {
    choices: [
      { id: 'same', text: 'First' },
      { id: 'same', text: 'Second' },
    ],
  },
  { choices: [{ id: 'empty', text: ' ' }] },
  { format: 'http-origin' },
  { defaultValue: 'production' },
  { inputType: 'boolean' },
  { variableName: '__choice_completed_blocks' },
])('rejects invalid group configuration %j', (change) => {
  expect(JsonInputBlockSchema.safeParse({ ...input, ...change }).success).toBe(false);
});

it.each([JsonSectionBlockSchema, JsonBlockSchema, JsonBlockSchemaNoRef])(
  'requires a stable ID for hidden sections',
  (schema) => {
    const section = { type: 'section', blocks: [], whenRequirementsUnmet: 'hide' };
    expect(schema.safeParse(section).success).toBe(false);
    expect(schema.safeParse({ ...section, id: 'production' }).success).toBe(true);
    expect(schema.safeParse({ type: 'section', blocks: [] }).success).toBe(true);
  }
);

it('reports dangling choice references and promotes them in strict mode', () => {
  const guide = {
    id: 'choice-test',
    title: 'Choice test',
    blocks: [
      input,
      {
        type: 'section',
        id: 'production',
        requirements: ['var-environments:includes:removed'],
        whenRequirementsUnmet: 'hide',
        blocks: [],
      },
    ],
  };
  const result = validateGuide(guide);
  expect(result.isValid).toBe(true);
  expect(result.warnings.some((warning) => warning.message.includes('has no option removed'))).toBe(true);
  expect(validateGuide(guide, { strict: true }).isValid).toBe(false);
});
