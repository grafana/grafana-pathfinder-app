#!/usr/bin/env node
/**
 * Pathfinder CLI
 *
 * Command-line tool for validating JSON guides.
 */

import { Command } from 'commander';

import { validateCommand } from './commands/validate';

const program = new Command();

program.name('pathfinder-cli').description('CLI tools for Grafana Pathfinder plugin').version('1.0.0');

program.addCommand(validateCommand);

program.parse(process.argv);
