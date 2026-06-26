const ECDSA_PARAMS = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN_PARAMS = { name: 'ECDSA', hash: 'SHA-256' } as const;
const HMAC_PARAMS = { name: 'HMAC', hash: 'SHA-256' } as const;

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

export async function generateSessionKeyPair(): Promise<{ publicKeyB64: string; privateKey: CryptoKey }> {
  const keyPair = await crypto.subtle.generateKey(ECDSA_PARAMS, true, ['sign', 'verify']);
  const spki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  return {
    publicKeyB64: toBase64url(new Uint8Array(spki)),
    privateKey: keyPair.privateKey,
  };
}

export async function signPayload(privateKey: CryptoKey, payload: string): Promise<string> {
  const bytes = new TextEncoder().encode(payload);
  const sig = await crypto.subtle.sign(SIGN_PARAMS, privateKey, bytes.buffer as ArrayBuffer);
  return toBase64url(new Uint8Array(sig));
}

export async function verifyPayload(publicKeyB64: string, payload: string, sig: string): Promise<boolean> {
  try {
    const spki = fromBase64url(publicKeyB64);
    const sigBytes = fromBase64url(sig);
    const payloadBytes = new TextEncoder().encode(payload);
    const publicKey = await crypto.subtle.importKey('spki', spki.buffer as ArrayBuffer, ECDSA_PARAMS, false, [
      'verify',
    ]);
    return await crypto.subtle.verify(
      SIGN_PARAMS,
      publicKey,
      sigBytes.buffer as ArrayBuffer,
      payloadBytes.buffer as ArrayBuffer
    );
  } catch {
    return false;
  }
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
