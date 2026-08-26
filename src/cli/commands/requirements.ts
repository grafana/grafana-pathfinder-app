/**
 * `pathfinder-cli requirements list` — print the canonical requirement
 * vocabulary so authors can discover valid `--requirements` / `--conditions`
 * tokens without reading source. The same registry is enforced by the schema
 * refinement on every parse, so this command is the single source of truth
 * for what "valid" means.
 *
 * A group of one: the vocabulary is one lookup today, and the root would need a
 * subcommand enumeration either way.
 */

import { z } from 'zod';

import {
  FIXED_REQUIREMENTS,
  PARAMETERIZED_REQUIREMENT_EXAMPLES,
  PARAMETERIZED_REQUIREMENT_PREFIXES,
} from '../../types/requirements.types';
import { defineCommand, defineCommandGroup } from '../contracts';
import type { CommandOutcome } from '../utils/output';

export const RequirementsListCommand = z.object({
  format: z.enum(['text', 'json']).default('text').describe('Output format').meta({ role: 'io' }),
  quiet: z.boolean().default(false).describe('Print bare tokens, one per line').meta({ role: 'io' }),
});

export type RequirementsListInput = z.output<typeof RequirementsListCommand>;

export function runRequirementsList(args: RequirementsListInput): CommandOutcome {
  if (args.format === 'json') {
    const payload = {
      fixed: [...FIXED_REQUIREMENTS],
      parameterized: PARAMETERIZED_REQUIREMENT_PREFIXES.map((prefix) => {
        const example = PARAMETERIZED_REQUIREMENT_EXAMPLES.find((e) => e.prefix === prefix)?.example ?? null;
        return { prefix, example };
      }),
    };
    console.log(JSON.stringify(payload, null, 2));
    return { status: 'ok', summary: 'Requirement vocabulary' };
  }
  if (args.quiet) {
    for (const r of FIXED_REQUIREMENTS) {
      console.log(r);
    }
    for (const { prefix, example } of PARAMETERIZED_REQUIREMENT_EXAMPLES) {
      console.log(example ?? `${prefix}<value>`);
    }
    return { status: 'ok', summary: 'Requirement vocabulary' };
  }
  console.log('Fixed requirements:');
  for (const r of FIXED_REQUIREMENTS) {
    console.log(`  ${r}`);
  }
  console.log('\nParameterized requirements (suffix with a value):');
  for (const { prefix, example } of PARAMETERIZED_REQUIREMENT_EXAMPLES) {
    console.log(`  ${prefix.padEnd(22)} e.g. ${example ?? `${prefix}<value>`}`);
  }
  console.log('\nUse any of these on --requirements (interactive blocks) or --conditions (conditional blocks).');
  return { status: 'ok', summary: 'Requirement vocabulary' };
}

export const requirementsListSpec = defineCommand({
  name: 'list',
  summary: 'Print all valid requirement tokens (fixed + parameterized prefixes)',
  schema: RequirementsListCommand,
  // The vocabulary listing is the output, in all three renderings.
  emits: 'stream',
  run: runRequirementsList,
});

export const requirementsGroup = defineCommandGroup({
  name: 'requirements',
  summary: 'Inspect the requirement / condition vocabulary recognized by the schema',
  discriminator: 'action',
  discriminatorDescription: 'Which vocabulary listing to print',
  variants: new Map([['list', requirementsListSpec]]),
});
