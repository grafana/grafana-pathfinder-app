// Jest setup provided by Grafana scaffolding
import './.config/jest-setup';

// Prism (pulled in transitively via @grafana/ui) auto-highlights the whole
// document on a rAF after load; in jsdom that sweep races tests that mock
// document.querySelectorAll. Manual mode disables only the automatic sweep —
// explicit Prism.highlightElement calls still work. Guarded because some
// suites opt into `@jest-environment node`.
if (typeof window !== 'undefined') {
  window.Prism = { manual: true };
}

// Polyfill crypto.subtle for jsdom — used by session-crypto tests
import { webcrypto } from 'crypto';
if (!globalThis.crypto.subtle) {
  Object.defineProperty(globalThis.crypto, 'subtle', {
    value: webcrypto.subtle,
    writable: false,
  });
}
