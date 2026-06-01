/**
 * Object-name builders for the GCS session layout.
 *
 * Every GCS path is built from `tokenObjectPrefix(token)` rather than the
 * token itself — the raw token is a bearer credential and hashing keeps it
 * out of bucket listings, Cloud Audit Logs, SDK error stack traces, and
 * the Cloud Console. See `session-store-gcs.ts` file-level doc for the
 * full layout (`generation` pointer + per-attempt `<stage>/` staging
 * dirs + `.pin` sidecar).
 */

import { tokenObjectPrefix } from '../session-token';

export const CONTENT_OBJECT = 'content.json';
export const MANIFEST_OBJECT = 'manifest.json';
export const GENERATION_OBJECT = 'generation';
export const MCP_SESSION_PIN_OBJECT = '.pin';

export function sessionPrefix(token: string): string {
  return tokenObjectPrefix(token);
}

export function stagedPrefix(token: string, stage: string): string {
  return `${sessionPrefix(token)}/${stage}`;
}

export function contentObjectName(token: string, stage: string): string {
  return `${stagedPrefix(token, stage)}/${CONTENT_OBJECT}`;
}

export function manifestObjectName(token: string, stage: string): string {
  return `${stagedPrefix(token, stage)}/${MANIFEST_OBJECT}`;
}

export function generationObjectName(token: string): string {
  return `${sessionPrefix(token)}/${GENERATION_OBJECT}`;
}

export function pinObjectName(token: string): string {
  return `${sessionPrefix(token)}/${MCP_SESSION_PIN_OBJECT}`;
}
