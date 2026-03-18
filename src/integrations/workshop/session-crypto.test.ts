import { generateSessionKeyPair, generateNonce, signChallenge, verifyChallenge } from './session-crypto';

describe('session-crypto', () => {
  describe('generateSessionKeyPair', () => {
    it('returns a base64url public key and a CryptoKey private key', async () => {
      const { publicKeyB64, privateKey } = await generateSessionKeyPair();
      expect(typeof publicKeyB64).toBe('string');
      expect(publicKeyB64.length).toBeGreaterThan(0);
      expect(typeof privateKey).toBe('object');
      expect(privateKey.type).toBe('private');
    });

    it('generates unique key pairs on each call', async () => {
      const [a, b] = await Promise.all([generateSessionKeyPair(), generateSessionKeyPair()]);
      expect(a.publicKeyB64).not.toBe(b.publicKeyB64);
    });

    it('private key is usable for signing', async () => {
      const { privateKey } = await generateSessionKeyPair();
      expect(privateKey.usages).toContain('sign');
    });
  });

  describe('generateNonce', () => {
    it('returns a 22-char base64url string', () => {
      const nonce = generateNonce();
      expect(typeof nonce).toBe('string');
      expect(nonce.length).toBe(22);
    });

    it('generates unique nonces on each call', () => {
      expect(generateNonce()).not.toBe(generateNonce());
    });
  });

  describe('signChallenge + verifyChallenge', () => {
    it('verifies a valid signature', async () => {
      const { publicKeyB64, privateKey } = await generateSessionKeyPair();
      const nonce = generateNonce();
      const sig = await signChallenge(privateKey, nonce);
      expect(await verifyChallenge(publicKeyB64, nonce, sig)).toBe(true);
    });

    it('rejects a signature for the wrong nonce', async () => {
      const { publicKeyB64, privateKey } = await generateSessionKeyPair();
      const sig = await signChallenge(privateKey, generateNonce());
      expect(await verifyChallenge(publicKeyB64, generateNonce(), sig)).toBe(false);
    });

    it('rejects a signature from a different key pair', async () => {
      const { publicKeyB64 } = await generateSessionKeyPair();
      const { privateKey: otherPrivateKey } = await generateSessionKeyPair();
      const nonce = generateNonce();
      const sig = await signChallenge(otherPrivateKey, nonce);
      expect(await verifyChallenge(publicKeyB64, nonce, sig)).toBe(false);
    });

    it('rejects a tampered signature', async () => {
      const { publicKeyB64, privateKey } = await generateSessionKeyPair();
      const nonce = generateNonce();
      const sig = await signChallenge(privateKey, nonce);
      const tampered = sig[0] === 'A' ? 'B' + sig.slice(1) : 'A' + sig.slice(1);
      expect(await verifyChallenge(publicKeyB64, nonce, tampered)).toBe(false);
    });

    it('rejects a garbage signature string', async () => {
      const { publicKeyB64 } = await generateSessionKeyPair();
      expect(await verifyChallenge(publicKeyB64, generateNonce(), 'not-valid-!!!')).toBe(false);
    });

    it('rejects a garbage public key', async () => {
      const { privateKey } = await generateSessionKeyPair();
      const nonce = generateNonce();
      const sig = await signChallenge(privateKey, nonce);
      expect(await verifyChallenge('invalidddddddddddddddddddd', nonce, sig)).toBe(false);
    });
  });
});
