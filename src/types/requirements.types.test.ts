/**
 * `REQUIREMENT_TOKEN_CATALOGUE` is what every authoring surface publishes as the
 * requirement vocabulary — the MCP's `pathfinder_help`, `x-requirement-tokens` on
 * the exported JSON Schema, the block editor's chip picker. It is enumerated from
 * the enums so it cannot fall behind them, which leaves exactly one way for it to
 * go wrong: a new enum member with no `REQUIREMENT_DESCRIPTIONS` entry, publishing
 * as a blank, or a new prefix with no `PARAMETERIZED_REQUIREMENT_EXAMPLES` entry,
 * publishing the catalogue's `<prefix><value>` placeholder. These fail on both.
 */

import {
  FIXED_REQUIREMENTS,
  FixedRequirementType,
  isValidRequirement,
  PARAMETERIZED_REQUIREMENT_EXAMPLES,
  PARAMETERIZED_REQUIREMENT_PREFIXES,
  ParameterizedRequirementPrefix,
  REQUIREMENT_DESCRIPTIONS,
  REQUIREMENT_TOKEN_CATALOGUE,
} from './requirements.types';

describe('REQUIREMENT_TOKEN_CATALOGUE', () => {
  it('covers every enum member and nothing else', () => {
    expect(REQUIREMENT_TOKEN_CATALOGUE.map((entry) => entry.token)).toEqual([
      ...Object.values(FixedRequirementType),
      ...Object.values(ParameterizedRequirementPrefix),
    ]);
  });

  it('classifies each token by which enum declares it', () => {
    const fixed = REQUIREMENT_TOKEN_CATALOGUE.filter((entry) => entry.kind === 'fixed').map((entry) => entry.token);
    const parameterized = REQUIREMENT_TOKEN_CATALOGUE.filter((entry) => entry.kind === 'parameterized').map(
      (entry) => entry.token
    );
    expect(fixed).toEqual([...FIXED_REQUIREMENTS]);
    expect(parameterized).toEqual([...PARAMETERIZED_REQUIREMENT_PREFIXES]);
  });

  // A blank description reaches an author as an empty tooltip, and a blank example
  // as a token they have to guess the shape of. Both are silent until someone reads
  // the published list, which is why this is a test and not a review habit.
  it.each(
    // `it.each` on the catalogue itself, so adding a member adds a case.
    REQUIREMENT_TOKEN_CATALOGUE.map((entry) => [entry.token, entry] as const)
  )('describes and exemplifies %s', (_token, entry) => {
    expect(entry.description).not.toBe('');
    expect(REQUIREMENT_DESCRIPTIONS[entry.token]).toBe(entry.description);
    expect(entry.example).not.toBe('');
  });

  it('publishes an example the validator accepts', () => {
    for (const entry of REQUIREMENT_TOKEN_CATALOGUE) {
      expect(isValidRequirement(entry.example)).toBe(true);
    }
  });

  it('takes a parameterized example from the examples table when it has one', () => {
    for (const { prefix, example } of PARAMETERIZED_REQUIREMENT_EXAMPLES) {
      expect(REQUIREMENT_TOKEN_CATALOGUE.find((entry) => entry.token === prefix)?.example).toBe(example);
    }
  });

  // Nothing above catches a prefix the examples table has never heard of: the
  // catalogue substitutes `<prefix><value>`, which is non-blank and which
  // `isValidRequirement` accepts against that very prefix.
  it.each([...PARAMETERIZED_REQUIREMENT_PREFIXES])('has an authored example for %s', (prefix) => {
    expect(PARAMETERIZED_REQUIREMENT_EXAMPLES.map((entry) => entry.prefix)).toContain(prefix);
  });
});
