/**
 * Tests for chrome-control.ts helpers.
 *
 * Validates nav visibility detection, toggle behavior, sidebar close/restore,
 * and idempotency of all operations.
 */

import { isNavVisible, collapseNav, expandNav, closeExtensionSidebar, restoreSidebar } from './chrome-control';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPublish = jest.fn();

jest.mock('@grafana/runtime', () => ({
  getAppEvents: () => ({ publish: mockPublish }),
}));

jest.mock('../global-state/sidebar', () => ({
  sidebarState: {
    openSidebar: jest.fn(),
  },
}));

const { sidebarState } = jest.requireMock('../global-state/sidebar');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addNavItems(count = 3): HTMLAnchorElement[] {
  const items: HTMLAnchorElement[] = [];
  for (let i = 0; i < count; i++) {
    const a = document.createElement('a');
    a.setAttribute('data-testid', 'data-testid Nav menu item');
    document.body.appendChild(a);
    items.push(a);
  }
  return items;
}

function addMegaMenuToggle(): HTMLButtonElement {
  const button = document.createElement('button');
  button.id = 'mega-menu-toggle';
  document.body.appendChild(button);
  return button;
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

afterEach(() => {
  document.body.innerHTML = '';
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('isNavVisible', () => {
  it('returns false when no nav items exist', () => {
    expect(isNavVisible()).toBe(false);
  });

  it('returns true when nav items are in the DOM', () => {
    addNavItems();
    expect(isNavVisible()).toBe(true);
  });
});

describe('collapseNav', () => {
  it('clicks mega-menu-toggle when nav is visible', () => {
    addNavItems();
    const toggle = addMegaMenuToggle();
    const clickSpy = jest.spyOn(toggle, 'click');

    collapseNav();

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when nav is already hidden', () => {
    const toggle = addMegaMenuToggle();
    const clickSpy = jest.spyOn(toggle, 'click');

    collapseNav();

    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('is a no-op when toggle button is missing', () => {
    addNavItems();
    // No toggle button added — should not throw
    expect(() => collapseNav()).not.toThrow();
  });
});

describe('expandNav', () => {
  it('clicks mega-menu-toggle when nav is hidden', () => {
    const toggle = addMegaMenuToggle();
    const clickSpy = jest.spyOn(toggle, 'click');

    expandNav();

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when nav is already visible', () => {
    addNavItems();
    const toggle = addMegaMenuToggle();
    const clickSpy = jest.spyOn(toggle, 'click');

    expandNav();

    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('is a no-op when toggle button is missing', () => {
    // No nav items, no toggle — should not throw
    expect(() => expandNav()).not.toThrow();
  });
});

describe('closeExtensionSidebar', () => {
  it('publishes close-extension-sidebar event', () => {
    closeExtensionSidebar();

    expect(mockPublish).toHaveBeenCalledWith({
      type: 'close-extension-sidebar',
      payload: {},
    });
  });
});

describe('restoreSidebar', () => {
  it('calls sidebarState.openSidebar with correct title', () => {
    restoreSidebar();

    expect(sidebarState.openSidebar).toHaveBeenCalledWith('Interactive learning');
  });
});
