/**
 * Tests for the docs-panel tab gate derivation.
 */

jest.mock('@grafana/runtime', () => ({
  config: { bootData: { user: { id: 1, orgRole: 'Viewer', isGrafanaAdmin: false } } },
}));

import { config } from '@grafana/runtime';
import { didGateClose, isCurrentUserEditor, resolveTabGates } from './tab-gates';

const mockUser = (user: Record<string, unknown>) => {
  (config as any).bootData.user = user;
};

describe('isCurrentUserEditor', () => {
  it.each([
    ['Editor', false, true],
    ['Admin', false, true],
    ['Viewer', true, true],
    ['Viewer', false, false],
  ])('orgRole %s / isGrafanaAdmin %s → %s', (orgRole, isGrafanaAdmin, expected) => {
    mockUser({ id: 1, orgRole, isGrafanaAdmin });
    expect(isCurrentUserEditor()).toBe(expected);
  });
});

describe('resolveTabGates', () => {
  beforeEach(() => {
    mockUser({ id: 1, orgRole: 'Viewer', isGrafanaAdmin: false });
  });

  it('allows Dev Tools only when dev mode names the current user', () => {
    expect(resolveTabGates({ devMode: true, devModeUserIds: [1] }).allowDevTools).toBe(true);
    expect(resolveTabGates({ devMode: true, devModeUserIds: [2] }).allowDevTools).toBe(false);
    expect(resolveTabGates({ devMode: false, devModeUserIds: [1] }).allowDevTools).toBe(false);
  });

  it('denies Dev Tools for an undefined config', () => {
    expect(resolveTabGates(undefined).allowDevTools).toBe(false);
  });
});

describe('didGateClose', () => {
  const open = { allowEditor: true, allowDevTools: true };

  it('is false without a previous observation, so a first read never unpersists', () => {
    expect(didGateClose(null, { allowEditor: false, allowDevTools: false })).toBe(false);
  });

  it.each([
    ['dev tools', { allowEditor: true, allowDevTools: false }],
    ['editor', { allowEditor: false, allowDevTools: true }],
  ])('detects %s closing', (_name, next) => {
    expect(didGateClose(open, next)).toBe(true);
  });

  it('is false when gates open or stay put', () => {
    expect(didGateClose({ allowEditor: false, allowDevTools: false }, open)).toBe(false);
    expect(didGateClose(open, open)).toBe(false);
  });
});
