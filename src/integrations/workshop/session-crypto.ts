/**
 * Cryptographic utilities for workshop session authentication
 *
 * Implements asymmetric challenge-response presenter verification using ECDSA P-256
 * via the browser-native Web Crypto API. No external dependencies.
 *
 * Security model:
 *   - Presenter generates an ECDSA key pair at session creation
 *   - The PUBLIC key is embedded in the join code (safe to share)
 *   - The PRIVATE key never leaves the presenter's browser session
 *   - Attendees challenge the presenter with a random nonce; only the holder of
 *     the private key can produce a valid signature — knowing the join code
 *     (and therefore the public key) does not allow impersonation
 */

// ============================================================================
// Base64url helpers
// ============================================================================

function toBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (padded.length % 4)) % 4;
  const base64 = padded + '='.repeat(padLength);
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ============================================================================
// Public API
// ============================================================================

const ECDSA_PARAMS = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN_PARAMS = { name: 'ECDSA', hash: 'SHA-256' } as const;

/**
 * Generate an ECDSA P-256 key pair for presenter authentication.
 *
 * The public key is returned as a base64url-encoded SPKI buffer — safe to
 * embed in the join code. The private key is a CryptoKey that stays in memory
 * on the presenter's side and is never serialised or transmitted.
 *
 * extractable is set to true so we can export the public key as SPKI.
 * We never call exportKey on the private key.
 */
export async function generateSessionKeyPair(): Promise<{ publicKeyB64: string; privateKey: CryptoKey }> {
  const keyPair = await crypto.subtle.generateKey(ECDSA_PARAMS, true, ['sign', 'verify']);
  const spki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  return {
    publicKeyB64: toBase64url(new Uint8Array(spki)),
    privateKey: keyPair.privateKey,
  };
}

/**
 * Generate a 16-byte random nonce encoded as base64url.
 * Called by the attendee when sending a presenter challenge.
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(new ArrayBuffer(16));
  crypto.getRandomValues(bytes);
  return toBase64url(bytes);
}

/**
 * Sign a nonce with the presenter's ECDSA private key.
 * Returns the signature as base64url.
 */
export async function signChallenge(privateKey: CryptoKey, nonce: string): Promise<string> {
  const nonceBytes = fromBase64url(nonce);
  const sig = await crypto.subtle.sign(SIGN_PARAMS, privateKey, nonceBytes.buffer as ArrayBuffer);
  return toBase64url(new Uint8Array(sig));
}

/**
 * Verify an ECDSA signature against the presenter's public key (from join code).
 * Returns false if the signature is invalid or any argument is malformed.
 */
export async function verifyChallenge(publicKeyB64: string, nonce: string, signature: string): Promise<boolean> {
  try {
    const spki = fromBase64url(publicKeyB64);
    const sigBytes = fromBase64url(signature);
    const nonceBytes = fromBase64url(nonce);

    const publicKey = await crypto.subtle.importKey('spki', spki.buffer as ArrayBuffer, ECDSA_PARAMS, false, [
      'verify',
    ]);

    return await crypto.subtle.verify(
      SIGN_PARAMS,
      publicKey,
      sigBytes.buffer as ArrayBuffer,
      nonceBytes.buffer as ArrayBuffer
    );
  } catch {
    return false;
  }
}
