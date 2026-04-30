/**
 * Tiny polyfill that runs before `.config/jest-setup.js` so individual test
 * files can opt into `@jest-environment node` without crashing the
 * jsdom-shaped scaffolded setup. The scaffolded file unconditionally
 * touches `HTMLCanvasElement.prototype.getContext`, which only exists in
 * jsdom; we stub it (and a few siblings) so the file runs harmlessly in
 * node-env test files (e.g., src/cli/mcp/__tests__/http.test.ts).
 *
 * Tests that actually need a real DOM continue to use the default jsdom
 * env and see the real implementations.
 */

if (typeof globalThis.HTMLCanvasElement === 'undefined') {
  class HTMLCanvasElementStub {}
  HTMLCanvasElementStub.prototype.getContext = () => null;
  globalThis.HTMLCanvasElement = HTMLCanvasElementStub;
}

if (typeof globalThis.matchMedia === 'undefined') {
  // jest-setup.js reassigns this; the stub here just keeps the property
  // descriptor coherent so that reassignment doesn't throw in node env.
  globalThis.matchMedia = () => ({
    matches: false,
    media: '',
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
