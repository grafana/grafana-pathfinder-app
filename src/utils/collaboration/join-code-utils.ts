/**
 * Utilities for generating and parsing join codes for collaborative sessions
 *
 * Join codes encode the WebRTC offer in a shareable format (QR code, URL, copy-paste)
 */

import QRCode from 'qrcode';
import type { SessionOffer, SessionAnswer, SessionError } from '../../types/collaboration.types';

/**
 * Generate a base64-encoded join code from a session offer
 *
 * @param offer - The session offer to encode
 * @returns Base64-encoded join code string
 */
export function generateJoinCode(offer: SessionOffer): string {
  try {
    const json = JSON.stringify(offer);
    return btoa(json);
  } catch (error) {
    console.error('Failed to generate join code:', error);
    throw error;
  }
}

/**
 * Parse a join code back into a session offer
 * With PeerJS, the join code IS the peer ID (simple string)
 *
 * @param code - Peer ID (e.g., "abc123")
 * @returns Parsed session offer
 * @throws Error if code is invalid
 */
export function parseJoinCode(code: string): SessionOffer {
  try {
    const trimmedCode = code.trim();

    // Try to decode as base64 JSON first (new format with session info)
    try {
      const decoded = atob(trimmedCode);
      const sessionData = JSON.parse(decoded);

      if (sessionData.id) {
        // Valid new format with session metadata
        return {
          id: sessionData.id,
          name: sessionData.name || 'Live Session',
          tutorialUrl: sessionData.url || '',
          defaultMode: 'guided',
          offer: {} as RTCSessionDescriptionInit,
          timestamp: Date.now(),
        };
      }
    } catch (decodeError) {
      // Not base64/JSON, try legacy format (plain peer ID)
    }

    // Legacy format: just the 6-character peer ID
    const lowerCode = trimmedCode.toLowerCase();
    if (/^[a-z0-9]{6}$/.test(lowerCode)) {
      return {
        id: lowerCode,
        name: 'Session',
        tutorialUrl: '',
        defaultMode: 'guided',
        offer: {} as RTCSessionDescriptionInit,
        timestamp: Date.now(),
      };
    }

    throw new Error('Invalid join code format');
  } catch (error) {
    console.error('Failed to parse join code:', error);
    const sessionError: SessionError = {
      code: 'INVALID_CODE',
      message: 'Invalid join code. Please check and try again.',
      details: error,
    };
    throw sessionError;
  }
}

/**
 * Generate a shareable URL with the join code embedded
 *
 * @param offer - The session offer
 * @param baseUrl - Base URL of the application (default: current origin)
 * @returns Full URL with session parameter
 */
export function generateJoinUrl(offer: SessionOffer, baseUrl?: string): string {
  const base = baseUrl || window.location.origin;
  const code = generateJoinCode(offer);
  // Encode the code to make it URL-safe
  const encoded = encodeURIComponent(code);
  return `${base}/a/grafana-grafanadocsplugin-app?session=${encoded}`;
}

/**
 * Parse session parameter from current URL
 *
 * @returns Session offer if present in URL, null otherwise
 */
export function parseSessionFromUrl(): SessionOffer | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const sessionParam = params.get('session');
    const sessionName = params.get('sessionName');
    const tutorialUrl = params.get('tutorialUrl');

    if (!sessionParam) {
      return null;
    }

    const decoded = decodeURIComponent(sessionParam);
    const baseSession = parseJoinCode(decoded);

    // Override with URL parameters if available
    return {
      ...baseSession,
      name: sessionName || baseSession.name,
      tutorialUrl: tutorialUrl || baseSession.tutorialUrl,
    };
  } catch (error) {
    console.error('Failed to parse session from URL:', error);
    return null;
  }
}

/**
 * Generate a QR code data URL from a session offer
 *
 * @param offer - The session offer
 * @param baseUrl - Base URL for the join link
 * @returns Promise resolving to QR code data URL (image)
 */
export async function generateQRCode(offer: SessionOffer, baseUrl?: string): Promise<string> {
  try {
    const joinUrl = generateJoinUrl(offer, baseUrl);
    // Generate QR code with reasonable size and error correction
    const qrCode = await QRCode.toDataURL(joinUrl, {
      width: 300,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    });
    return qrCode;
  } catch (error) {
    console.error('Failed to generate QR code:', error);
    throw error;
  }
}

/**
 * Generate a join code for an attendee's answer
 *
 * @param answer - The session answer to encode
 * @returns Base64-encoded answer code
 */
export function generateAnswerCode(answer: SessionAnswer): string {
  try {
    const json = JSON.stringify(answer);
    return btoa(json);
  } catch (error) {
    console.error('Failed to generate answer code:', error);
    throw error;
  }
}

/**
 * Parse an answer code back into a session answer
 *
 * @param code - Base64-encoded answer code
 * @returns Parsed session answer
 * @throws Error if code is invalid
 */
export function parseAnswerCode(code: string): SessionAnswer {
  try {
    const json = atob(code);
    const answer = JSON.parse(json) as SessionAnswer;

    // Validate required fields
    if (!answer.attendeeId || !answer.mode || !answer.answer) {
      throw new Error('Invalid session answer structure');
    }

    return answer;
  } catch (error) {
    console.error('Failed to parse answer code:', error);
    const sessionError: SessionError = {
      code: 'INVALID_CODE',
      message: 'Invalid or malformed answer code',
      details: error,
    };
    throw sessionError;
  }
}

/**
 * Generate a short, human-readable session ID
 *
 * @returns Random 8-character session ID
 */
export function generateSessionId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

/**
 * Generate a unique attendee ID
 *
 * @returns Random attendee ID with timestamp
 */
export function generateAttendeeId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 5);
  return `att_${timestamp}_${random}`;
}

/**
 * Validate if a join code is properly formatted (basic check)
 *
 * @param code - Code to validate
 * @returns True if code appears valid
 */
export function isValidJoinCode(code: string): boolean {
  try {
    // Basic validation: must be base64
    const decoded = atob(code);
    const parsed = JSON.parse(decoded);
    return !!(parsed && parsed.id && parsed.offer);
  } catch {
    return false;
  }
}
