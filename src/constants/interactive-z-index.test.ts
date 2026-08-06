import { createTheme } from '@grafana/data';
import { INTERACTIVE_Z_INDEX } from './interactive-z-index';

// Regression guard for #1439: the floating panel portals into the shared
// `#grafana-portal-container`, so it stacks as a sibling of every Grafana
// Dropdown/Menu/Tooltip/Modal. If its z-index is above Grafana's overlay layer,
// menus and modals opened from within the popped-out panel render behind it and
// become unusable. It must sit below the overlay band but above app chrome.
describe('INTERACTIVE_Z_INDEX floating panel layering', () => {
  const { zIndex } = createTheme();

  it('keeps the floating panel below every Grafana overlay layer', () => {
    expect(INTERACTIVE_Z_INDEX.FLOATING_PANEL).toBeLessThan(zIndex.portal);
    expect(INTERACTIVE_Z_INDEX.FLOATING_PANEL).toBeLessThan(zIndex.modal);
    expect(INTERACTIVE_Z_INDEX.FLOATING_PANEL).toBeLessThan(zIndex.modalBackdrop);
  });

  it('keeps the floating panel above Grafana app chrome', () => {
    expect(INTERACTIVE_Z_INDEX.FLOATING_PANEL).toBeGreaterThan(zIndex.navbarFixed);
    expect(INTERACTIVE_Z_INDEX.FLOATING_PANEL).toBeGreaterThan(zIndex.sidemenu);
  });

  it('keeps interactive guide overlays above the panel and the Grafana overlay layer', () => {
    // Highlights, blocking overlay and comment boxes are appended to document.body
    // and must remain visible above both the panel and any Grafana overlay.
    expect(INTERACTIVE_Z_INDEX.BLOCKING_OVERLAY).toBeGreaterThan(INTERACTIVE_Z_INDEX.FLOATING_PANEL);
    expect(INTERACTIVE_Z_INDEX.COMMENT_BOX).toBeGreaterThan(zIndex.portal);
    expect(INTERACTIVE_Z_INDEX.HIGHLIGHT_OUTLINE).toBeGreaterThan(zIndex.portal);
  });
});
