/**
 * `pathfinder-cli requirements list` — print the canonical requirement
 * vocabulary so authors can discover valid `--requirements` / `--conditions`
 * tokens without reading source. The same registry is enforced by the schema
 * refinement on every parse, so this command is the single source of truth
 * for what "valid" means.
 */

import { Command } from 'commander';

import {
  FIXED_REQUIREMENTS,
  PARAMETERIZED_REQUIREMENT_EXAMPLES,
  PARAMETERIZED_REQUIREMENT_PREFIXES,
} from '../../types/requirements.types';
import { readOutputOptions } from '../utils/output';

export const requirementsCommand = new Command('requirements').description(
  'Inspect the requirement / condition vocabulary recognized by the schema'
);

requirementsCommand
  .command('list')
  .description('Print all valid requirement tokens (fixed + parameterized prefixes)')
  .action(function (this: Command) {
    const output = readOutputOptions(this);
    if (output.format === 'json') {
      const payload = {
        fixed: [...FIXED_REQUIREMENTS],
        parameterized: PARAMETERIZED_REQUIREMENT_PREFIXES.map((prefix) => {
          const example = PARAMETERIZED_REQUIREMENT_EXAMPLES.find((e) => e.prefix === prefix)?.example ?? null;
          return { prefix, example };
        }),
      };
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    if (output.quiet) {
      for (const r of FIXED_REQUIREMENTS) {
        console.log(r);
      }
      for (const { prefix, example } of PARAMETERIZED_REQUIREMENT_EXAMPLES) {
        console.log(example ?? `${prefix}<value>`);
      }
      return;
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
  });
