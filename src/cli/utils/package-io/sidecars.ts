/**
 * Disk I/O for a package's translation sidecars, `i18n/<tag>.json`
 * (docs/design/I18N.md §5.2). The read path never throws, so `validate` can
 * report every bad file and keep going; the write path is the one sidecar
 * writer, sharing `content.json`'s serializer.
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import type { z } from 'zod';

import {
  TRANSLATION_SIDECAR_DIR,
  TranslationSidecarSchema,
  type TranslationSidecar,
} from '../../../types/translation-sidecar.schema';
import { readJsonFile } from '../../../validation/package-io';
import { serializeJson } from './disk';
import { PackageIOError } from './errors';

const SIDECAR_EXTENSION = '.json';

/** Tags become file names, so only BCP 47 characters are allowed. */
const SIDECAR_TAG_PATTERN = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

export type SidecarReadErrorCode = 'read_error' | 'invalid_json' | 'schema_validation';

export interface SidecarReadSuccess {
  ok: true;
  tag: string;
  filePath: string;
  sidecar: TranslationSidecar;
}

export interface SidecarReadFailure {
  ok: false;
  /** Absent when the `i18n/` directory itself could not be listed. */
  tag?: string;
  filePath: string;
  code: SidecarReadErrorCode;
  message: string;
  issues?: z.core.$ZodIssue[];
}

export type SidecarReadResult = SidecarReadSuccess | SidecarReadFailure;

export function sidecarPath(packageDir: string, tag: string): string {
  return path.join(packageDir, TRANSLATION_SIDECAR_DIR, `${tag}${SIDECAR_EXTENSION}`);
}

function tagOf(fileName: string): string {
  return fileName.slice(0, -SIDECAR_EXTENSION.length);
}

function compareTags(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function listSidecarFiles(dir: string): { files: string[] } | { error: SidecarReadFailure } | undefined {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return undefined;
    }
    return { error: { ok: false, filePath: dir, code: 'read_error', message: `Cannot read: ${dir}` } };
  }
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(SIDECAR_EXTENSION))
    .map((entry) => entry.name)
    .sort((a, b) => compareTags(tagOf(a), tagOf(b)));
  return { files };
}

/**
 * Every `i18n/*.json` in the package, sorted by tag, each parsed or
 * reported. A package with no `i18n/` directory returns an empty list.
 */
export function readPackageSidecars(packageDir: string): SidecarReadResult[] {
  const dir = path.join(packageDir, TRANSLATION_SIDECAR_DIR);
  const listing = listSidecarFiles(dir);
  if (!listing) {
    return [];
  }
  if ('error' in listing) {
    return [listing.error];
  }
  return listing.files.map((fileName): SidecarReadResult => {
    const tag = tagOf(fileName);
    const filePath = path.join(dir, fileName);
    const result = readJsonFile(filePath, TranslationSidecarSchema);
    if (result.ok) {
      // Zod reorders loose keys after declared ones; the raw value keeps file order.
      return { ok: true, tag, filePath, sidecar: result.parsed as TranslationSidecar };
    }
    // The file was listed a moment ago, so a vanished file is a read error.
    const code = result.code === 'not_found' ? 'read_error' : result.code;
    return { ok: false, tag, filePath, code, message: result.message, issues: result.issues };
  });
}

export interface SidecarEntries extends SidecarReadSuccess {
  /** The asked-for block ids this sidecar keys an entry by, in file order. */
  blockIds: string[];
}

/**
 * The sidecars with a `blocks.<id>` entry for any of `blockIds`, and the ones
 * that could not be read, sorted by tag. Each caller formats its own messages.
 */
export function findSidecarEntries(
  packageDir: string,
  blockIds: ReadonlySet<string>
): Array<SidecarEntries | SidecarReadFailure> {
  return readPackageSidecars(packageDir).flatMap((result): Array<SidecarEntries | SidecarReadFailure> => {
    if (!result.ok) {
      return [result];
    }
    const found = Object.keys(result.sidecar.blocks ?? {}).filter((id) => blockIds.has(id));
    return found.length > 0 ? [{ ...result, blockIds: found }] : [];
  });
}

function writeFailed(filePath: string, err: unknown): PackageIOError {
  const detail = err instanceof Error ? err.message : String(err);
  return new PackageIOError({
    code: 'WRITE_FAILED',
    message: `Failed to write sidecar to ${filePath}: ${detail}`,
  });
}

function ensureSidecarDir(packageDir: string): string {
  const dir = path.join(packageDir, TRANSLATION_SIDECAR_DIR);
  try {
    fs.mkdirSync(packageDir, { recursive: true });
    fs.mkdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw writeFailed(dir, err);
    }
  }
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(dir);
  } catch (err) {
    throw writeFailed(dir, err);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new PackageIOError({
      code: 'WRITE_FAILED',
      message: `Refusing to write sidecars: ${dir} is not a directory inside the package`,
    });
  }
  return dir;
}

/**
 * Write one sidecar with the serializer `writePackage` uses for
 * `content.json`. The value is schema-checked but written as given, so key
 * order survives a read-modify-write.
 */
export function writePackageSidecar(packageDir: string, tag: string, sidecar: TranslationSidecar): void {
  if (!SIDECAR_TAG_PATTERN.test(tag)) {
    throw new PackageIOError({
      code: 'INVALID_OPTIONS',
      message: `Invalid sidecar language tag "${tag}"`,
    });
  }
  const parsed = TranslationSidecarSchema.safeParse(sidecar);
  if (!parsed.success) {
    throw new PackageIOError(
      { code: 'SCHEMA_VALIDATION', message: `Sidecar ${tag} does not match the sidecar schema` },
      parsed.error.issues.map((issue) => ({
        code: 'SCHEMA_VALIDATION',
        message: issue.message,
        path: issue.path.map(String),
      }))
    );
  }
  const dir = ensureSidecarDir(packageDir);
  const filePath = sidecarPath(packageDir, tag);
  // Rename replaces a link at the destination instead of writing through it.
  const tempPath = path.join(dir, `.${tag}.${randomUUID()}.tmp`);
  let fd: number;
  try {
    fd = fs.openSync(tempPath, 'wx');
  } catch (err) {
    throw writeFailed(filePath, err);
  }
  try {
    try {
      fs.writeFileSync(fd, serializeJson(sidecar));
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    fs.rmSync(tempPath, { force: true });
    throw writeFailed(filePath, err);
  }
}
