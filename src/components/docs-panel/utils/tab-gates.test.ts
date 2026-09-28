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

  it('allows Dev Tools only when both the tenant gate and this user opted in', () => {
    expect(resolveTabGates({ devMode: true, devModeOptIn: true }).allowDevTools).toBe(true);
    // Tenant gate on, this user has not opted in.
    expect(resolveTabGates({ devMode: true, devModeOptIn: false }).allowDevTools).toBe(false);
    // This user opted in, but an admin has the instance gate off — the admin wins.
    expect(resolveTabGates({ devMode: false, devModeOptIn: true }).allowDevTools).toBe(false);
  });

  it('ignores the legacy allow-list on a config that skipped the resolve layer', () => {
    // Pre-migration jsonData handed straight to the gate: `devModeUserIds` is
    // deprecated and no longer consulted here. In the app the config always
    // arrives via publishPathfinderPluginConfig, which folds a legacy entry into
    // `devModeOptIn` first (see usePathfinderPluginConfig); this pins the
    // behaviour of the raw path so the gate never re-grows a second code path.
    expect(resolveTabGates({ devMode: true, devModeUserIds: [1] }).allowDevTools).toBe(false);
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
