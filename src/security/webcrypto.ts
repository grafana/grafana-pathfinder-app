const ECDSA_PARAMS = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN_PARAMS = { name: 'ECDSA', hash: 'SHA-256' } as const;

export function toBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(str: string): Uint8Array {
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

export async function generateEcdsaKeyPair(
  extractable: boolean
): Promise<{ publicKeyB64: string; privateKey: CryptoKey }> {
  const keyPair = await crypto.subtle.generateKey(ECDSA_PARAMS, extractable, ['sign', 'verify']);
  const spki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  return {
    publicKeyB64: toBase64url(new Uint8Array(spki)),
    privateKey: keyPair.privateKey,
  };
}

export async function signBytes(privateKey: CryptoKey, bytes: Uint8Array): Promise<string> {
  const sig = await crypto.subtle.sign(SIGN_PARAMS, privateKey, bytes.buffer as ArrayBuffer);
  return toBase64url(new Uint8Array(sig));
}

export async function verifyBytes(publicKeyB64: string, bytes: Uint8Array, sig: string): Promise<boolean> {
  try {
    const spki = fromBase64url(publicKeyB64);
    const sigBytes = fromBase64url(sig);
    const publicKey = await crypto.subtle.importKey('spki', spki.buffer as ArrayBuffer, ECDSA_PARAMS, false, [
      'verify',
    ]);
    return await crypto.subtle.verify(
      SIGN_PARAMS,
      publicKey,
      sigBytes.buffer as ArrayBuffer,
      bytes.buffer as ArrayBuffer
    );
  } catch {
    return false;
  }
}
