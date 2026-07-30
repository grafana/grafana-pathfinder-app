/**
 * Client-side payload normalization for completion facts, applied at emission.
 *
 * The backend remains the authoritative validator (it bounds field byte-lengths,
 * rejects control characters, and enforces the time window). Clamping here keeps
 * a legitimately oversized title/source from consuming the bounded queue and
 * then being silently dropped on a terminal 400 — see `payload-boundary-normalization`.
 */

/** Byte ceiling for identifier-class fields (source, id, pathId). Matches the backend. */
export const MAX_ID_BYTES = 256;
/** Byte ceiling for the guide title. Matches the backend. */
export const MAX_TITLE_BYTES = 1024;

// Strip C0 control characters and DEL. Built from an escaped pattern so the
// source stays ASCII-clean (no literal control bytes in the file).
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g');

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

function byteLength(value: string): number {
  return encoder ? encoder.encode(value).length : value.length;
}

/**
 * Strip control characters and clamp to `maxBytes` UTF-8 bytes without splitting
 * a multi-byte code point.
 */
export function normalizeField(value: string, maxBytes: number): string {
  const stripped = value.replace(CONTROL_CHARS, '');
  if (byteLength(stripped) <= maxBytes) {
    return stripped;
  }
  let out = '';
  let bytes = 0;
  for (const ch of stripped) {
    const chBytes = byteLength(ch);
    if (bytes + chBytes > maxBytes) {
      break;
    }
    out += ch;
    bytes += chBytes;
  }
  return out;
}

/** An identifier is valid when it is a non-empty string after normalization. */
export function isValidIdentifier(value: string): boolean {
  return normalizeField(value, MAX_ID_BYTES).length > 0;
}
