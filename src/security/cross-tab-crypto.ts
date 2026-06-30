import { fromBase64url, generateEcdsaKeyPair, signBytes, toBase64url, verifyBytes } from './webcrypto';

const HMAC_PARAMS = { name: 'HMAC', hash: 'SHA-256' } as const;

export async function generateSessionKeyPair(): Promise<{ publicKeyB64: string; privateKey: CryptoKey }> {
  return generateEcdsaKeyPair(false);
}

export async function signPayload(privateKey: CryptoKey, payload: string): Promise<string> {
  return signBytes(privateKey, new TextEncoder().encode(payload));
}

export async function verifyPayload(publicKeyB64: string, payload: string, sig: string): Promise<boolean> {
  return verifyBytes(publicKeyB64, new TextEncoder().encode(payload), sig);
}

async function importHmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  const bytes = new TextEncoder().encode(secret);
  return crypto.subtle.importKey('raw', bytes.buffer as ArrayBuffer, HMAC_PARAMS, false, usages);
}

export async function signHmacPayload(secret: string, payload: string): Promise<string> {
  const key = await importHmacKey(secret, ['sign']);
  const bytes = new TextEncoder().encode(payload);
  const sig = await crypto.subtle.sign(HMAC_PARAMS, key, bytes.buffer as ArrayBuffer);
  return toBase64url(new Uint8Array(sig));
}

export async function verifyHmacPayload(secret: string, payload: string, sig: string): Promise<boolean> {
  try {
    const key = await importHmacKey(secret, ['verify']);
    const sigBytes = fromBase64url(sig);
    const payloadBytes = new TextEncoder().encode(payload);
    return await crypto.subtle.verify(
      HMAC_PARAMS,
      key,
      sigBytes.buffer as ArrayBuffer,
      payloadBytes.buffer as ArrayBuffer
    );
  } catch {
    return false;
  }
}
