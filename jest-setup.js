// Jest setup provided by Grafana scaffolding
import './.config/jest-setup';

// Polyfill crypto.subtle for jsdom — used by session-crypto tests
import { webcrypto } from 'crypto';
if (!globalThis.crypto.subtle) {
  Object.defineProperty(globalThis.crypto, 'subtle', {
    value: webcrypto.subtle,
    writable: false,
  });
}
