import type React from 'react';
import * as ReactDOM from 'react-dom';
import { createCompatRoot } from './create-root-compat';

jest.mock('react-dom', () => ({
  __esModule: true,
  render: jest.fn(),
  unmountComponentAtNode: jest.fn(),
}));

const legacyDom = ReactDOM as unknown as {
  render?: jest.Mock;
  unmountComponentAtNode?: jest.Mock;
};
const systemHost = globalThis as typeof globalThis & { System?: { import: jest.Mock } };
const originalSystem = Object.getOwnPropertyDescriptor(globalThis, 'System');

beforeEach(() => {
  legacyDom.render = jest.fn();
  legacyDom.unmountComponentAtNode = jest.fn();
  Object.defineProperty(globalThis, 'System', {
    configurable: true,
    writable: true,
    value: { import: jest.fn().mockRejectedValue(new Error('Module not registered')) },
  });
});

afterEach(() => {
  if (originalSystem) {
    Object.defineProperty(globalThis, 'System', originalSystem);
  } else {
    delete systemHost.System;
  }
});

test('uses the React 18 legacy API without requesting react-dom/client', async () => {
  const container = document.createElement('div');
  const element = {} as React.ReactElement;

  const root = await createCompatRoot(container);
  root.render(element);
  root.unmount();

  expect(systemHost.System!.import).not.toHaveBeenCalled();
  expect(legacyDom.render).toHaveBeenCalledWith(element, container);
  expect(legacyDom.unmountComponentAtNode).toHaveBeenCalledWith(container);
});

test('uses the React 19 root when the legacy API is absent', async () => {
  legacyDom.render = undefined;
  legacyDom.unmountComponentAtNode = undefined;
  const nativeRoot = { render: jest.fn(), unmount: jest.fn() };
  const createRoot = jest.fn().mockReturnValue(nativeRoot);
  systemHost.System!.import.mockResolvedValue({ createRoot });
  const container = document.createElement('div');

  expect(await createCompatRoot(container)).toBe(nativeRoot);
  expect(systemHost.System!.import).toHaveBeenCalledWith('react-dom/client');
  expect(createRoot).toHaveBeenCalledWith(container);
});

test('rejects when neither root API is available', async () => {
  legacyDom.render = undefined;
  legacyDom.unmountComponentAtNode = undefined;
  systemHost.System!.import.mockResolvedValue({});

  await expect(createCompatRoot(document.createElement('div'))).rejects.toThrow('supported React root API');
});

test('reports an unavailable React 19 module at root creation', async () => {
  legacyDom.render = undefined;
  legacyDom.unmountComponentAtNode = undefined;

  await expect(createCompatRoot(document.createElement('div'))).rejects.toThrow('Module not registered');
});

test('rejects when the host provides neither SystemJS nor a legacy root', async () => {
  legacyDom.render = undefined;
  legacyDom.unmountComponentAtNode = undefined;
  delete systemHost.System;

  await expect(createCompatRoot(document.createElement('div'))).rejects.toThrow('supported React root API');
});
