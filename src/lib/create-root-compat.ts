import type React from 'react';

interface CompatRoot {
  render(element: React.ReactElement): void;
  unmount(): void;
}

/**
 * Creates a React root that works on both React 18 and React 19 Grafana hosts.
 *
 * The challenge: `react-dom/client` is registered as a SystemJS module on
 * React 19 hosts but NOT on React 18 hosts. A normal `import('react-dom/client')`
 * would be processed by webpack and emitted as a SystemJS dependency — causing a
 * fatal 404 during module registration on hosts that don't provide it.
 *
 * Solution: call `System.import('react-dom/client')` directly at runtime. Webpack
 * doesn't analyze `System.import()` calls, so `react-dom/client` never appears in
 * the chunk's dependency array. On React 19 hosts the call succeeds and we get the
 * native `createRoot`. On React 18 hosts the call rejects (404) and the catch
 * branch falls back to `ReactDOM.render` from `react-dom` (always registered).
 * The fallback is unreachable on React 19 hosts, so the removal of
 * `ReactDOM.render` in React 19 is safe.
 */
export async function createCompatRoot(container: HTMLElement): Promise<CompatRoot> {
  try {
    const System = (globalThis as any).System;
    if (System?.import) {
      const reactDomClient = await System.import('react-dom/client');
      if (typeof reactDomClient?.createRoot === 'function') {
        return reactDomClient.createRoot(container);
      }
    }
  } catch {
    // react-dom/client not registered on this host — fall through to legacy API
  }

  const ReactDOM = await import('react-dom');
  return {
    render(element: React.ReactElement) {
      (ReactDOM as any).render(element, container);
    },
    unmount() {
      (ReactDOM as any).unmountComponentAtNode(container);
    },
  };
}
