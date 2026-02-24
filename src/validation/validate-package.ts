/**
 * Package Validation Module
 *
 * Validates a package directory containing content.json and
 * optional manifest.json. Performs cross-file consistency checks,
 * asset reference validation, and testEnvironment validation.
 */

import * as fs from 'fs';
import * as path from 'path';

import { ContentJsonSchema, ManifestJsonSchema } from '../types/package.schema';
import { CURRENT_SCHEMA_VERSION } from '../types/json-guide.schema';
import type { ValidationError, ValidationWarning } from './errors';
import { validateGuide, type ValidationResult } from './validate-guide';

export type MessageSeverity = 'error' | 'warn' | 'info';

export interface PackageValidationMessage {
  severity: MessageSeverity;
  message: string;
  path?: string[];
}

export interface PackageValidationResult {
  isValid: boolean;
  packageId: string | null;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  messages: PackageValidationMessage[];
  contentResult: ValidationResult | null;
}

export interface PackageValidationOptions {
  strict?: boolean;
}

/**
 * Validate a package directory.
 * Expects at minimum content.json; manifest.json is optional.
 */
export function validatePackage(packageDir: string, options: PackageValidationOptions = {}): PackageValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const messages: PackageValidationMessage[] = [];
  let packageId: string | null = null;
  let contentResult: ValidationResult | null = null;

  const contentPath = path.join(packageDir, 'content.json');
  const manifestPath = path.join(packageDir, 'manifest.json');
  const assetsDir = path.join(packageDir, 'assets');

  // --- Validate content.json ---

  if (!fs.existsSync(contentPath)) {
    errors.push({
      message: 'content.json not found in package directory',
      path: ['content.json'],
      code: 'missing_content',
    });
    return { isValid: false, packageId, errors, warnings, messages, contentResult };
  }

  let contentRaw: string;
  try {
    contentRaw = fs.readFileSync(contentPath, 'utf-8');
  } catch {
    errors.push({
      message: 'Cannot read content.json',
      path: ['content.json'],
      code: 'read_error',
    });
    return { isValid: false, packageId, errors, warnings, messages, contentResult };
  }

  let contentParsed: unknown;
  try {
    contentParsed = JSON.parse(contentRaw);
  } catch {
    errors.push({
      message: 'content.json is not valid JSON',
      path: ['content.json'],
      code: 'invalid_json',
    });
    return { isValid: false, packageId, errors, warnings, messages, contentResult };
  }

  const contentSchemaResult = ContentJsonSchema.safeParse(contentParsed);
  if (!contentSchemaResult.success) {
    for (const issue of contentSchemaResult.error.issues) {
      errors.push({
        message: `content.json: ${issue.message}`,
        path: ['content.json', ...issue.path.map(String)],
        code: 'schema_validation',
      });
    }
    return { isValid: false, packageId, errors, warnings, messages, contentResult };
  }

  const content = contentSchemaResult.data;
  packageId = content.id;

  contentResult = validateGuide(contentParsed, {
    strict: options.strict,
    skipUnknownFieldCheck: false,
  });

  if (!contentResult.isValid) {
    for (const err of contentResult.errors) {
      errors.push({ ...err, message: `content.json: ${err.message}` });
    }
  }
  for (const warn of contentResult.warnings) {
    warnings.push({ ...warn, message: `content.json: ${warn.message}` });
  }

  // --- Validate manifest.json (optional) ---

  if (fs.existsSync(manifestPath)) {
    let manifestRaw: string;
    try {
      manifestRaw = fs.readFileSync(manifestPath, 'utf-8');
    } catch {
      errors.push({
        message: 'Cannot read manifest.json',
        path: ['manifest.json'],
        code: 'read_error',
      });
      return { isValid: false, packageId, errors, warnings, messages, contentResult };
    }

    let manifestParsed: unknown;
    try {
      manifestParsed = JSON.parse(manifestRaw);
    } catch {
      errors.push({
        message: 'manifest.json is not valid JSON',
        path: ['manifest.json'],
        code: 'invalid_json',
      });
      return { isValid: false, packageId, errors, warnings, messages, contentResult };
    }

    const manifestResult = ManifestJsonSchema.safeParse(manifestParsed);
    if (!manifestResult.success) {
      for (const issue of manifestResult.error.issues) {
        errors.push({
          message: `manifest.json: ${issue.message}`,
          path: ['manifest.json', ...issue.path.map(String)],
          code: 'schema_validation',
        });
      }
    } else {
      const manifest = manifestResult.data;

      // Cross-file ID consistency
      if (manifest.id !== content.id) {
        errors.push({
          message: `ID mismatch: content.json has "${content.id}", manifest.json has "${manifest.id}"`,
          path: ['id'],
          code: 'id_mismatch',
        });
      }

      // Emit severity-based messages for manifest field defaults
      emitManifestMessages(manifestParsed as Record<string, unknown>, manifest, messages);

      // testEnvironment validation
      if (manifest.testEnvironment) {
        validateTestEnvironment(manifest.testEnvironment, messages);
      }
    }
  } else {
    messages.push({
      severity: 'info',
      message: 'No manifest.json found — package has content only (standalone guide)',
    });
  }

  // --- Asset reference validation ---

  validateAssetReferences(contentRaw, assetsDir, packageDir, warnings);

  const isValid = errors.length === 0 && (contentResult?.isValid ?? true);

  if (options.strict && warnings.length > 0) {
    return {
      isValid: false,
      packageId,
      errors: [
        ...errors,
        ...warnings.map((w) => ({
          message: w.message,
          path: w.path,
          code: 'strict' as const,
        })),
      ],
      warnings: [],
      messages,
      contentResult,
    };
  }

  return { isValid, packageId, errors, warnings, messages, contentResult };
}

/**
 * Validate a tree of package directories.
 */
export function validatePackageTree(
  rootDir: string,
  options: PackageValidationOptions = {}
): Map<string, PackageValidationResult> {
  const results = new Map<string, PackageValidationResult>();

  if (!fs.existsSync(rootDir)) {
    return results;
  }

  const entries = fs.readdirSync(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packageDir = path.join(rootDir, entry.name);
    const contentPath = path.join(packageDir, 'content.json');

    if (fs.existsSync(contentPath)) {
      results.set(entry.name, validatePackage(packageDir, options));
    }
  }

  return results;
}

// --- Internal helpers ---

function emitManifestMessages(
  raw: Record<string, unknown>,
  parsed: { id: string; type: string; [key: string]: unknown },
  messages: PackageValidationMessage[]
): void {
  // Defaults with INFO
  const infoDefaults: Array<[string, string]> = [
    ['repository', 'interactive-tutorials'],
    ['language', 'en'],
    ['schemaVersion', CURRENT_SCHEMA_VERSION],
  ];

  for (const [field, defaultValue] of infoDefaults) {
    if (raw[field] === undefined) {
      messages.push({
        severity: 'info',
        message: `manifest.json: "${field}" not specified, defaulting to "${defaultValue}"`,
        path: ['manifest.json', field],
      });
    }
  }

  const depFields = ['depends', 'recommends', 'suggests', 'provides', 'conflicts', 'replaces'];
  for (const field of depFields) {
    if (raw[field] === undefined) {
      messages.push({
        severity: 'info',
        message: `manifest.json: "${field}" not specified, defaulting to []`,
        path: ['manifest.json', field],
      });
    }
  }

  // Defaults with WARN
  const warnFields = ['description', 'category', 'targeting', 'startingLocation'];
  for (const field of warnFields) {
    if (raw[field] === undefined) {
      const msg =
        field === 'startingLocation'
          ? `manifest.json: "${field}" not specified, defaulting to "/"`
          : `manifest.json: "${field}" not specified`;
      messages.push({
        severity: 'warn',
        message: msg,
        path: ['manifest.json', field],
      });
    }
  }

  // INFO for optional fields
  if (raw['author'] === undefined) {
    messages.push({
      severity: 'info',
      message: 'manifest.json: "author" not specified',
      path: ['manifest.json', 'author'],
    });
  }

  if (raw['testEnvironment'] === undefined) {
    messages.push({
      severity: 'info',
      message: 'manifest.json: "testEnvironment" not specified, using default cloud environment',
      path: ['manifest.json', 'testEnvironment'],
    });
  }
}

function validateTestEnvironment(
  testEnv: { tier?: string; minVersion?: string; datasets?: string[]; datasources?: string[]; plugins?: string[] },
  messages: PackageValidationMessage[]
): void {
  if (testEnv.tier && !['local', 'cloud', 'managed'].includes(testEnv.tier)) {
    messages.push({
      severity: 'warn',
      message: `manifest.json: testEnvironment.tier "${testEnv.tier}" is not a recognized tier (local, cloud, managed)`,
      path: ['manifest.json', 'testEnvironment', 'tier'],
    });
  }

  if (testEnv.minVersion) {
    const semverPattern = /^\d+\.\d+\.\d+$/;
    if (!semverPattern.test(testEnv.minVersion)) {
      messages.push({
        severity: 'warn',
        message: `manifest.json: testEnvironment.minVersion "${testEnv.minVersion}" is not valid semver`,
        path: ['manifest.json', 'testEnvironment', 'minVersion'],
      });
    }
  }
}

function validateAssetReferences(
  contentRaw: string,
  assetsDir: string,
  packageDir: string,
  warnings: ValidationWarning[]
): void {
  const assetRefPattern = /\.\/assets\/([^"'\s)]+)/g;
  let match: RegExpExecArray | null;

  while ((match = assetRefPattern.exec(contentRaw)) !== null) {
    const assetPath = match[1];
    if (!assetPath) {
      continue;
    }

    const fullAssetPath = path.join(assetsDir, assetPath);

    if (!fs.existsSync(fullAssetPath)) {
      warnings.push({
        message: `Asset reference "./assets/${assetPath}" not found in package directory`,
        path: ['content.json', 'assets', assetPath],
        type: 'missing-asset',
      });
    }
  }
}
