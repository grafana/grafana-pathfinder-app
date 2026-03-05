/**
 * Shared I/O utilities for reading and validating package JSON files.
 *
 * Used by both validate-package (validation) and build-repository (CLI)
 * to eliminate the duplicated read → parse → schema-validate pipeline.
 */

import * as fs from 'fs';

import type { z } from 'zod';

export type JsonReadSuccess<T> = {
  ok: true;
  data: T;
  raw: string;
  parsed: unknown;
};

export type JsonReadFailure = {
  ok: false;
  code: 'not_found' | 'read_error' | 'invalid_json' | 'schema_validation';
  message: string;
  issues?: z.core.$ZodIssue[];
};

export type JsonReadResult<T> = JsonReadSuccess<T> | JsonReadFailure;

/**
 * Read a JSON file, parse it, and validate against a Zod schema.
 * Returns the validated data plus the raw string and untyped parsed object
 * (both useful for downstream checks like asset reference scanning or
 * passing to validateGuide which accepts unknown).
 */
export function readJsonFile<T>(filePath: string, schema: z.ZodType<T>): JsonReadResult<T> {
  if (!fs.existsSync(filePath)) {
    return { ok: false, code: 'not_found', message: `File not found: ${filePath}` };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return { ok: false, code: 'read_error', message: `Cannot read: ${filePath}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'invalid_json', message: `Invalid JSON in: ${filePath}` };
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      code: 'schema_validation',
      message: `Schema validation failed for: ${filePath}`,
      issues: result.error.issues,
    };
  }

  return { ok: true, data: result.data, raw, parsed };
}
