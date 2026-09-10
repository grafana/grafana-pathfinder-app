/** @jest-environment node */

import * as fs from 'fs';
import * as path from 'path';

import { getTypeScriptCompileClosure, validateCliBuildContract } from './cli-build-contract';
import { REPO_ROOT } from './import-graph';

const readRepositoryFile = (relativePath: string): string =>
  fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf-8');

const compileClosure = getTypeScriptCompileClosure(path.join(REPO_ROOT, 'tsconfig.cli.json'));

describe('CLI compile closure build contract', () => {
  it('keeps every required source file in Docker and publish workflow inputs', () => {
    const errors = validateCliBuildContract(compileClosure, {
      dockerfile: readRepositoryFile('Dockerfile.cli'),
      dockerignore: readRepositoryFile('.dockerignore'),
      workflows: {
        '.github/workflows/cli-publish.yml': readRepositoryFile('.github/workflows/cli-publish.yml'),
        '.github/workflows/e2e-runner-publish.yml': readRepositoryFile('.github/workflows/e2e-runner-publish.yml'),
      },
    });

    if (errors.length > 0) {
      throw new Error(
        `CLI compile closure build contract failed:\n\n${errors.map((error) => `  - ${error}`).join('\n')}`
      );
    }
  });
});
