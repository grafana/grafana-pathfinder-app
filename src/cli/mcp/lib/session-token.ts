/**
 * Session tokens for the GCS-backed authoring session store (P7).
 *
 * A token is an opaque bearer capability minted by the MCP on the first
 * mutation tool call of an authoring session. The agent passes it back
 * verbatim on every subsequent call; the server uses it as the GCS object
 * prefix (`<token>/content.json`, `<token>/manifest.json`).
 *
 * Format: 22 characters, Crockford base32 (lowercase output).
 *   - Alphabet: 0123456789abcdefghjkmnpqrstvwxyz (drops I, L, O, U to
 *     avoid lookalikes; matches the design's confidentiality spec).
 *   - 22 chars * 5 bits = 110 bits of entropy from a CSPRNG.
 *   - Lowercased on input — agents that pass a mixed-case token are
 *     normalized server-side so a transcription that flipped case still
 *     resolves.
 *
 * The token is distinct from the transport-layer `Mcp-Session-Id` HTTP
 * header. The token is LLM-visible; `Mcp-Session-Id` is not. They serve
 * different purposes — token = access key, transport id = optional pin.
 *
 * Logging discipline: production code never logs raw tokens. Use
 * `tokenLogPrefix` (first 12 chars, recognizable for support without
 * being a full bearer credential) or `tokenLogHash` (sha-256, opaque).
 */

import { createHash, randomBytes } from 'node:crypto';

/** Crockford base32 alphabet, lowercase. Excludes I, L, O, U. */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const TOKEN_LENGTH = 22;

/** Mint a fresh, high-entropy session token. */
export function generateSessionToken(): string {
  // 22 chars * 5 bits = 110 bits. Generate 14 bytes (112 bits) and take 22 chars worth.
  const bytes = randomBytes(14);
  let bits = 0;
  let bitCount = 0;
  let out = '';
  for (let i = 0; i < bytes.length && out.length < TOKEN_LENGTH; i++) {
    const byte = bytes[i] ?? 0;
    bits = (bits << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5 && out.length < TOKEN_LENGTH) {
      bitCount -= 5;
      const idx = (bits >> bitCount) & 0x1f;
      const ch = ALPHABET[idx];
      if (ch === undefined) {
        // Unreachable — idx is masked to 5 bits and ALPHABET has 32 entries.
        throw new Error('generateSessionToken: index out of range (impossible)');
      }
      out += ch;
    }
  }
  return out;
}

/**
 * True iff `s` is exactly `TOKEN_LENGTH` chars and every char is in the
 * Crockford-lowercase alphabet. Callers must `normalizeSessionToken` first
 * if they want to accept mixed-case input — this is the strict check.
 */
export function isValidSessionToken(s: unknown): s is string {
  if (typeof s !== 'string' || s.length !== TOKEN_LENGTH) {
    return false;
  }
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === undefined || !ALPHABET.includes(ch)) {
      return false;
    }
  }
  return true;
}

/**
 * Lowercase + reject lookalikes. Returns the canonical form, or `null` if
 * the input cannot be coerced (wrong length, non-alphabet character even
 * after case folding). Used at the tool input boundary so an agent that
 * passes `T8h9k...` gets the same session as `t8h9k...`.
 */
export function normalizeSessionToken(s: unknown): string | null {
  if (typeof s !== 'string') {
    return null;
  }
  const lower = s.toLowerCase();
  return isValidSessionToken(lower) ? lower : null;
}

/**
 * First 12 characters of the token — recognizable enough for a support
 * engineer to correlate a log line with a session report, narrow enough
 * (60 bits) that disclosure does not compromise the bearer capability.
 *
 * Throws on invalid input rather than returning a partial string so a
 * caller who forgot to validate fails loudly rather than silently logging
 * garbage.
 */
export function tokenLogPrefix(token: string): string {
  if (!isValidSessionToken(token)) {
    throw new Error('tokenLogPrefix: invalid session token');
  }
  return token.slice(0, 12);
}

/**
 * SHA-256 of the token, hex-encoded, first 16 chars. Stable identifier
 * across log lines for the same session, with no way back to the token.
 * Prefer this over `tokenLogPrefix` for high-volume telemetry; prefer
 * `tokenLogPrefix` for human-readable debugging.
 */
export function tokenLogHash(token: string): string {
  if (!isValidSessionToken(token)) {
    throw new Error('tokenLogHash: invalid session token');
  }
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

export const __testing = {
  ALPHABET,
  TOKEN_LENGTH,
};
