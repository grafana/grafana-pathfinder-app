import {
  EXTENSION_SIDEBAR_DOCKED_KEY,
  clearExtensionSidebarDocked,
  isExtensionSidebarInUse,
  isExtensionSidebarOwnedByOther,
  isExtensionSidebarOwnedByPathfinder,
  parseExtensionSidebarDocked,
} from './extension-sidebar';

const MY_PLUGIN_ID = 'grafana-pathfinder-app';
const TITLE_MATCH = 'Interactive learning';

beforeEach(() => {
  localStorage.clear();
});

describe('parseExtensionSidebarDocked', () => {
  it('returns null when the key is absent', () => {
    expect(parseExtensionSidebarDocked()).toBeNull();
  });

  it('parses JSON object shape with pluginId + componentTitle', () => {
    localStorage.setItem(
      EXTENSION_SIDEBAR_DOCKED_KEY,
      JSON.stringify({ pluginId: MY_PLUGIN_ID, componentTitle: TITLE_MATCH })
    );

    expect(parseExtensionSidebarDocked()).toEqual({
      pluginId: MY_PLUGIN_ID,
      componentTitle: TITLE_MATCH,
    });
  });

  it('falls back to treating the raw value as pluginId on JSON parse failure', () => {
    localStorage.setItem(EXTENSION_SIDEBAR_DOCKED_KEY, MY_PLUGIN_ID);

    expect(parseExtensionSidebarDocked()).toEqual({ pluginId: MY_PLUGIN_ID });
  });

  it('returns undefined for non-string fields in JSON', () => {
    localStorage.setItem(EXTENSION_SIDEBAR_DOCKED_KEY, JSON.stringify({ pluginId: 42, componentTitle: null }));

    expect(parseExtensionSidebarDocked()).toEqual({
      pluginId: undefined,
      componentTitle: undefined,
    });
  });

  it('returns null when storage throws', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = jest.fn(() => {
      throw new Error('storage unavailable');
    });
    try {
      expect(parseExtensionSidebarDocked()).toBeNull();
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});

describe('isExtensionSidebarOwnedByOther', () => {
  it('false when nothing is docked', () => {
    expect(isExtensionSidebarOwnedByOther(MY_PLUGIN_ID)).toBe(false);
  });

  it('false when the docked surface is us (object shape)', () => {
    localStorage.setItem(EXTENSION_SIDEBAR_DOCKED_KEY, JSON.stringify({ pluginId: MY_PLUGIN_ID }));
    expect(isExtensionSidebarOwnedByOther(MY_PLUGIN_ID)).toBe(false);
  });

  it('false when the docked surface is us (legacy string shape)', () => {
    localStorage.setItem(EXTENSION_SIDEBAR_DOCKED_KEY, MY_PLUGIN_ID);
    expect(isExtensionSidebarOwnedByOther(MY_PLUGIN_ID)).toBe(false);
  });

  it('true when another plugin is docked (object shape)', () => {
    localStorage.setItem(EXTENSION_SIDEBAR_DOCKED_KEY, JSON.stringify({ pluginId: 'other-plugin' }));
    expect(isExtensionSidebarOwnedByOther(MY_PLUGIN_ID)).toBe(true);
  });

  it('true when another plugin is docked (legacy string shape)', () => {
    localStorage.setItem(EXTENSION_SIDEBAR_DOCKED_KEY, 'other-plugin');
    expect(isExtensionSidebarOwnedByOther(MY_PLUGIN_ID)).toBe(true);
  });

  it('false when pluginId is missing/invalid', () => {
    localStorage.setItem(EXTENSION_SIDEBAR_DOCKED_KEY, JSON.stringify({ pluginId: 42 }));
    expect(isExtensionSidebarOwnedByOther(MY_PLUGIN_ID)).toBe(false);
  });
});

describe('isExtensionSidebarOwnedByPathfinder', () => {
  it('matches by pluginId', () => {
    localStorage.setItem(EXTENSION_SIDEBAR_DOCKED_KEY, JSON.stringify({ pluginId: MY_PLUGIN_ID }));
    expect(isExtensionSidebarOwnedByPathfinder(MY_PLUGIN_ID, TITLE_MATCH)).toBe(true);
  });

  it('matches by componentTitle (older Grafana versions)', () => {
    localStorage.setItem(
      EXTENSION_SIDEBAR_DOCKED_KEY,
      JSON.stringify({ pluginId: undefined, componentTitle: TITLE_MATCH })
    );
    expect(isExtensionSidebarOwnedByPathfinder(MY_PLUGIN_ID, TITLE_MATCH)).toBe(true);
  });

  it('false when neither match', () => {
    localStorage.setItem(
      EXTENSION_SIDEBAR_DOCKED_KEY,
      JSON.stringify({ pluginId: 'other', componentTitle: 'Other component' })
    );
    expect(isExtensionSidebarOwnedByPathfinder(MY_PLUGIN_ID, TITLE_MATCH)).toBe(false);
  });

  it('matches legacy plain string as pluginId', () => {
    localStorage.setItem(EXTENSION_SIDEBAR_DOCKED_KEY, MY_PLUGIN_ID);
    expect(isExtensionSidebarOwnedByPathfinder(MY_PLUGIN_ID, TITLE_MATCH)).toBe(true);
  });
});

describe('isExtensionSidebarInUse / clearExtensionSidebarDocked', () => {
  it('inUse is false when absent, true when present (any shape)', () => {
    expect(isExtensionSidebarInUse()).toBe(false);

    localStorage.setItem(EXTENSION_SIDEBAR_DOCKED_KEY, 'x');
    expect(isExtensionSidebarInUse()).toBe(true);
  });

  it('clear() removes the key', () => {
    localStorage.setItem(EXTENSION_SIDEBAR_DOCKED_KEY, 'x');
    clearExtensionSidebarDocked();
    expect(localStorage.getItem(EXTENSION_SIDEBAR_DOCKED_KEY)).toBeNull();
  });
});
