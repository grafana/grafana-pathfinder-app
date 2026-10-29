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

// Analytics values are snake_case (#2067); fail any test whose code path
// reported a kebab-case value so a new emitter cannot drift unnoticed.
import { drainValueCasingViolations } from './src/lib/analytics-value-check';
afterEach(() => {
  const violations = drainValueCasingViolations();
  if (violations.length > 0) {
    throw new Error(
      `Analytics values must be snake_case (see docs/developer/TELEMETRY.md, "Value conventions"):\n${violations.join('\n')}`
    );
  }
});
