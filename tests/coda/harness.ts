import { resolve } from 'node:path';
import type * as SharedHarness from './.harness/fixtures';

// The runner installs this shared module beside the consumer's Playwright dependencies.
export const { test, expect, control, onlyVM, resource }: typeof SharedHarness = require(
  resolve(__dirname, '.harness/fixtures.ts')
);
