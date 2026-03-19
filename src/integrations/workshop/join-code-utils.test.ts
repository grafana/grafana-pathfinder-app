import { parseJoinCode, parseSessionFromUrl, isValidJoinCode, generateJoinCode } from './join-code-utils';
import type { SessionOffer } from '../../types/collaboration.types';

describe('join-code-utils', () => {
  describe('parseJoinCode', () => {
    it('extracts sessionPublicKey from new-format base64 JSON', () => {
      const pubkey = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEtest==';
      const joinCodeData = { id: 'abc123', name: 'Test Session', url: '/tutorial', pubkey };
      const code = btoa(JSON.stringify(joinCodeData));

      const result = parseJoinCode(code);

      expect(result.id).toBe('abc123');
      expect(result.name).toBe('Test Session');
      expect(result.tutorialUrl).toBe('/tutorial');
      expect(result.sessionPublicKey).toBe(pubkey);
    });

    it('returns sessionPublicKey as undefined for legacy 6-char peer ID', () => {
      const result = parseJoinCode('abc123');

      expect(result.id).toBe('abc123');
      expect(result.sessionPublicKey).toBeUndefined();
    });

    it('handles old-format JSON with tutorialUrl field', () => {
      const joinCodeData = { id: 'abc123', name: 'Test', tutorialUrl: '/guide' };
      const code = btoa(JSON.stringify(joinCodeData));

      const result = parseJoinCode(code);

      expect(result.tutorialUrl).toBe('/guide');
    });

    it('handles old-format JSON with sessionPublicKey field', () => {
      const pubkey = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAElegacy==';
      const joinCodeData = { id: 'abc123', name: 'Test', url: '/guide', sessionPublicKey: pubkey };
      const code = btoa(JSON.stringify(joinCodeData));

      const result = parseJoinCode(code);

      expect(result.sessionPublicKey).toBe(pubkey);
    });
  });

  describe('isValidJoinCode', () => {
    it('returns true for a new-format base64 JSON code', () => {
      const code = btoa(JSON.stringify({ id: 'abc123', name: 'Test', url: '/tour' }));
      expect(isValidJoinCode(code)).toBe(true);
    });

    it('returns true for a legacy 6-char alphanumeric code', () => {
      expect(isValidJoinCode('abc123')).toBe(true);
    });

    it('returns false for a garbage string', () => {
      expect(isValidJoinCode('not-a-valid-code!!!')).toBe(false);
    });

    it('returns false for an empty string', () => {
      expect(isValidJoinCode('')).toBe(false);
    });
  });

  describe('generateJoinCode', () => {
    const baseOffer: SessionOffer = {
      id: 'test01',
      name: 'Test Session',
      tutorialUrl: '/my/guide',
      defaultMode: 'guided',
      offer: {} as RTCSessionDescriptionInit,
      timestamp: 0,
    };

    it('serialises tutorialUrl as url field (compact key)', () => {
      const code = generateJoinCode(baseOffer);
      const parsed = JSON.parse(atob(code));
      expect(parsed.url).toBe('/my/guide');
      expect(parsed.tutorialUrl).toBeUndefined();
    });

    it('serialises sessionPublicKey as pubkey field (compact key)', () => {
      const offer = { ...baseOffer, sessionPublicKey: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEtest==' };
      const code = generateJoinCode(offer);
      const parsed = JSON.parse(atob(code));
      expect(parsed.pubkey).toBe('MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEtest==');
      expect(parsed.sessionPublicKey).toBeUndefined();
    });

    it('omits pubkey field when sessionPublicKey is not set', () => {
      const code = generateJoinCode(baseOffer);
      const parsed = JSON.parse(atob(code));
      expect(parsed.pubkey).toBeUndefined();
    });

    it('round-trips sessionPublicKey through generateJoinCode → parseJoinCode', () => {
      const pubkey = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEtest==';
      const offer = { ...baseOffer, sessionPublicKey: pubkey };
      const code = generateJoinCode(offer);
      const result = parseJoinCode(code);
      expect(result.sessionPublicKey).toBe(pubkey);
      expect(result.tutorialUrl).toBe('/my/guide');
    });
  });

  describe('parseSessionFromUrl', () => {
    it('preserves sessionPublicKey through the URL round-trip', () => {
      const pubkey = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEtest==';
      const joinCodeData = { id: 'xyz789', name: 'Live Session', url: '/tour', pubkey };
      const joinCode = btoa(JSON.stringify(joinCodeData));

      const originalSearch = window.location.search;
      window.history.pushState({}, '', `?session=${encodeURIComponent(joinCode)}`);

      const result = parseSessionFromUrl();

      window.history.pushState({}, '', originalSearch || '/');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('xyz789');
      expect(result!.sessionPublicKey).toBe(pubkey);
    });
  });
});
