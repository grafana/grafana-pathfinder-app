/**
 * Session tokens for the authoring session store. An opaque bearer capability
 * minted on first mutation and passed back verbatim to address the session.
 * Format: 22-char Crockford base32 (lowercase; no I/L/O/U), 110 bits of CSPRNG
 * entropy. Distinct from the transport `Mcp-Session-Id` (token = access key,
 * id = optional pin). Never log a raw token — use `tokenLogPrefix`/`tokenLogHash`.
 */

import { createHash, randomBytes } from 'node:crypto';

/** Crockford base32 alphabet, lowercase. Excludes I, L, O, U. */
export const CROCKFORD_LOWERCASE_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const TOKEN_LENGTH = 22;

/** Encode CSPRNG bytes as `length` Crockford-base32 chars. */
export function crockfordBase32(bytes: Buffer, length: number): string {
  let bits = 0;
  let bitCount = 0;
  let out = '';
  for (let i = 0; i < bytes.length && out.length < length; i++) {
    bits = (bits << 8) | (bytes[i] ?? 0);
    bitCount += 8;
    while (bitCount >= 5 && out.length < length) {
      bitCount -= 5;
      out += CROCKFORD_LOWERCASE_ALPHABET.charAt((bits >> bitCount) & 0x1f);
    }
  }
  return out;
}

/** Mint a fresh session token (22 chars × 5 bits = 110 bits of entropy). */
export function generateSessionToken(): string {
  return crockfordBase32(randomBytes(14), TOKEN_LENGTH);
}

/** Strict check: exactly `TOKEN_LENGTH` Crockford-lowercase chars. Run `normalizeSessionToken` first to accept mixed case. */
export function isValidSessionToken(s: unknown): s is string {
  if (typeof s !== 'string' || s.length !== TOKEN_LENGTH) {
    return false;
  }
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === undefined || !CROCKFORD_LOWERCASE_ALPHABET.includes(ch)) {
      return false;
    }
  }
  return true;
}

/** Lowercase + validate, returning the canonical token or `null`. Used at the tool input boundary so a case-flipped transcription still resolves. */
export function normalizeSessionToken(s: unknown): string | null {
  if (typeof s !== 'string') {
    return null;
  }
  const lower = s.toLowerCase();
  return isValidSessionToken(lower) ? lower : null;
}

/** First 12 chars — enough to correlate logs, too few (60 bits) to be the credential. Throws on invalid input rather than logging garbage. */
export function tokenLogPrefix(token: string): string {
  if (!isValidSessionToken(token)) {
    throw new Error('tokenLogPrefix: invalid session token');
  }
  return token.slice(0, 12);
}

/** SHA-256 (first 16 hex chars) — a stable cross-line correlator with no way back to the token. */
export function tokenLogHash(token: string): string {
  if (!isValidSessionToken(token)) {
    throw new Error('tokenLogHash: invalid session token');
  }
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

/** Stable hash of an `Mcp-Session-Id` for logs — it's pin/confidentiality material, so never logged raw. Accepts any non-empty string (the header has no fixed format). */
export function mcpSessionIdLogHash(mcpSessionId: string): string {
  return createHash('sha256').update(mcpSessionId).digest('hex').slice(0, 16);
}
