import type React from 'react';

interface CompatRoot {
  render(element: React.ReactElement): void;
  unmount(): void;
}

interface LegacyReactDOM {
  render?: (element: React.ReactElement, container: HTMLElement) => void;
  unmountComponentAtNode?: (container: HTMLElement) => void;
}

export async function createCompatRoot(container: HTMLElement): Promise<CompatRoot> {
  const reactDom = (await import('react-dom')) as LegacyReactDOM;
  const { render, unmountComponentAtNode } = reactDom;
  if (typeof render === 'function' && typeof unmountComponentAtNode === 'function') {
    return {
      render: (element) => render(element, container),
      unmount: () => unmountComponentAtNode(container),
    };
  }

  // Only hosts without the legacy API need react-dom/client; React 18 hosts do not register it.
  const System = (globalThis as typeof globalThis & { System?: { import: (name: string) => Promise<unknown> } }).System;
  if (System?.import) {
    // Keep this import out of webpack's static SystemJS dependencies for older hosts.
    const reactDomClient = (await System.import('react-dom/client')) as {
      createRoot?: (container: HTMLElement) => CompatRoot;
    };
    if (typeof reactDomClient?.createRoot === 'function') {
      return reactDomClient.createRoot(container);
    }
  }

  throw new Error('This Grafana host does not provide a supported React root API.');
}
