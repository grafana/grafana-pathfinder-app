#!/usr/bin/env node
/**
 * Pathfinder CLI
 *
 * Command-line tool for validating JSON guides.
 */

import { Command } from 'commander';

import { e2eCommand } from './commands/e2e';
import { validateCommand } from './commands/validate';

const program = new Command();

program.name('pathfinder-cli').description('CLI tools for Grafana Pathfinder plugin').version('1.0.0');

program.addCommand(validateCommand);
program.addCommand(e2eCommand);

program.parse(process.argv);
