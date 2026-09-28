const UNKNOWN_VM_EXPIRY_PREFIX = '0001-';
const MINUTE_MS = 60_000;

export function parseVmExpiry(expiresAt: string | null | undefined): number | null {
  if (!expiresAt || expiresAt.startsWith(UNKNOWN_VM_EXPIRY_PREFIX)) {
    return null;
  }

  const timestamp = Date.parse(expiresAt);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function formatVmExpiry(expiresAt: string | null | undefined, nowMs = Date.now()): string | null {
  const expiryMs = parseVmExpiry(expiresAt);
  if (expiryMs === null) {
    return null;
  }

  const remainingMs = expiryMs - nowMs;
  if (remainingMs <= 0) {
    return 'Session expired';
  }

  const minutes = Math.ceil(remainingMs / MINUTE_MS);
  return `${minutes} min left`;
}
