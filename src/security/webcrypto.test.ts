import { fromBase64url, generateEcdsaKeyPair, signBytes, toBase64url, verifyBytes } from './webcrypto';

describe('webcrypto', () => {
  describe('base64url', () => {
    it('round-trips arbitrary bytes', () => {
      const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
      expect(Array.from(fromBase64url(toBase64url(bytes)))).toEqual(Array.from(bytes));
    });

    it('emits url-safe output with no padding', () => {
      const encoded = toBase64url(new Uint8Array([251, 255, 191]));
      expect(encoded).not.toMatch(/[+/=]/);
    });
  });

  describe('generateEcdsaKeyPair', () => {
    it('returns a base64url public key and a private signing key', async () => {
      const { publicKeyB64, privateKey } = await generateEcdsaKeyPair(false);
      expect(typeof publicKeyB64).toBe('string');
      expect(publicKeyB64.length).toBeGreaterThan(0);
      expect(privateKey.type).toBe('private');
      expect(privateKey.usages).toContain('sign');
    });

    it('honors the extractable flag', async () => {
      const nonExtractable = await generateEcdsaKeyPair(false);
      const extractable = await generateEcdsaKeyPair(true);
      expect(nonExtractable.privateKey.extractable).toBe(false);
      expect(extractable.privateKey.extractable).toBe(true);
    });
  });

  describe('signBytes + verifyBytes', () => {
    const payload = new TextEncoder().encode('hello world');

    it('verifies a valid signature', async () => {
      const { publicKeyB64, privateKey } = await generateEcdsaKeyPair(false);
      const sig = await signBytes(privateKey, payload);
      expect(await verifyBytes(publicKeyB64, payload, sig)).toBe(true);
    });

    it('rejects a signature over different bytes', async () => {
      const { publicKeyB64, privateKey } = await generateEcdsaKeyPair(false);
      const sig = await signBytes(privateKey, payload);
      expect(await verifyBytes(publicKeyB64, new TextEncoder().encode('tampered'), sig)).toBe(false);
    });

    it('rejects a signature from a different key pair', async () => {
      const { privateKey } = await generateEcdsaKeyPair(false);
      const { publicKeyB64: otherPub } = await generateEcdsaKeyPair(false);
      const sig = await signBytes(privateKey, payload);
      expect(await verifyBytes(otherPub, payload, sig)).toBe(false);
    });

    it('returns false for a garbage public key or signature instead of throwing', async () => {
      const { publicKeyB64, privateKey } = await generateEcdsaKeyPair(false);
      const sig = await signBytes(privateKey, payload);
      expect(await verifyBytes('not-a-key', payload, sig)).toBe(false);
      expect(await verifyBytes(publicKeyB64, payload, 'not-valid-!!!')).toBe(false);
    });
  });
});
