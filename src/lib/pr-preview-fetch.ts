import { prPreviewContext, snapshotFileUrl, type PrSnapshot } from './pr-preview-core';
import { isDevModeEnabledGlobal } from '../utils/dev-mode';

export function activePrPreview(value: string) {
  const context = prPreviewContext(value);
  return context && isDevModeEnabledGlobal() ? context : undefined;
}

export class PrSnapshotFetchError extends Error {
  constructor(
    readonly status: number,
    path: string
  ) {
    super(`PR snapshot file ${path} could not be loaded (HTTP ${status}).`);
  }
}

export async function fetchSnapshotJson(snapshot: PrSnapshot, path: string, signal?: AbortSignal): Promise<unknown> {
  if (!isDevModeEnabledGlobal()) {
    throw new Error('Enable dev mode to preview PR content on this stack.');
  }
  const response = await fetch(snapshotFileUrl(snapshot, path), {
    credentials: 'omit',
    redirect: 'error',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new PrSnapshotFetchError(response.status, path);
  }
  return response.json();
}
