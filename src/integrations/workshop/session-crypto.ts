/**
 * Workshop presenter authentication: ECDSA P-256 challenge-response. The public
 * key ships in the join code; the non-extractable private key stays in the
 * presenter's session, so knowing the join code can't impersonate the presenter.
 */
import { fromBase64url, generateEcdsaKeyPair, signBytes, toBase64url, verifyBytes } from '../../security/webcrypto';

export async function generateSessionKeyPair(): Promise<{ publicKeyB64: string; privateKey: CryptoKey }> {
  return generateEcdsaKeyPair(false);
}

export function generateNonce(): string {
  const bytes = new Uint8Array(new ArrayBuffer(16));
  crypto.getRandomValues(bytes);
  return toBase64url(bytes);
}

export async function signChallenge(privateKey: CryptoKey, nonce: string): Promise<string> {
  return signBytes(privateKey, fromBase64url(nonce));
}

export async function verifyChallenge(publicKeyB64: string, nonce: string, signature: string): Promise<boolean> {
  try {
    return await verifyBytes(publicKeyB64, fromBase64url(nonce), signature);
  } catch {
    return false;
  }
}
