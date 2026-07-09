import { detectModalActive, getVisibleModalRects, startModalWatch, stopModalWatch } from './modal-watcher';

function addDialog(attrs: Record<string, string> = {}, opacity = '1'): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('role', 'dialog');
  el.style.opacity = opacity;
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  document.body.appendChild(el);
  return el;
}

function mockRect(el: HTMLElement, left: number, top: number, width: number, height: number) {
  el.getBoundingClientRect = () =>
    ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
}

afterEach(() => {
  // Drain the refcounted watcher back to zero regardless of what a test left.
  for (let i = 0; i < 5; i++) {
    stopModalWatch();
  }
  document.body.innerHTML = '';
});

describe('detectModalActive', () => {
  it('returns true for a visible role="dialog"', () => {
    addDialog();
    expect(detectModalActive()).toBe(true);
  });

  it('returns true for [aria-modal="true"] and [data-overlay-container="true"]', () => {
    const m = document.createElement('div');
    m.setAttribute('aria-modal', 'true');
    m.style.opacity = '1';
    document.body.appendChild(m);
    expect(detectModalActive()).toBe(true);

    document.body.innerHTML = '';
    const o = document.createElement('div');
    o.setAttribute('data-overlay-container', 'true');
    o.style.opacity = '1';
    document.body.appendChild(o);
    expect(detectModalActive()).toBe(true);
  });

  it('returns true for the journey image lightbox (.journey-image-modal, no role/aria)', () => {
    const lightbox = document.createElement('div');
    lightbox.className = 'journey-image-modal';
    lightbox.style.opacity = '1';
    document.body.appendChild(lightbox);
    expect(detectModalActive()).toBe(true);
  });

  it('excludes the Pathfinder floating panel (role="dialog" + data-pathfinder-content)', () => {
    addDialog({ 'data-pathfinder-content': 'true' });
    expect(detectModalActive()).toBe(false);
  });

  it('excludes dialogs nested inside the Pathfinder panel', () => {
    const panel = document.createElement('div');
    panel.setAttribute('data-pathfinder-content', 'true');
    const nested = document.createElement('div');
    nested.setAttribute('role', 'dialog');
    nested.style.opacity = '1';
    panel.appendChild(nested);
    document.body.appendChild(panel);
    expect(detectModalActive()).toBe(false);
  });

  it('ignores hidden dialogs (display/visibility/opacity)', () => {
    const d = addDialog();
    d.style.display = 'none';
    expect(detectModalActive()).toBe(false);
    d.style.display = '';
    d.style.visibility = 'hidden';
    expect(detectModalActive()).toBe(false);
    d.style.visibility = '';
    d.style.opacity = '0';
    expect(detectModalActive()).toBe(false);
  });

  it('returns false with no modal present', () => {
    expect(detectModalActive()).toBe(false);
  });
});

describe('getVisibleModalRects', () => {
  it('returns one rect per visible modal, across all selector shapes', () => {
    const dialog = addDialog();
    mockRect(dialog, 0, 0, 300, 300);
    const lightbox = document.createElement('div');
    lightbox.className = 'journey-image-modal';
    lightbox.style.opacity = '1';
    document.body.appendChild(lightbox);
    mockRect(lightbox, 400, 400, 200, 200);

    const rects = getVisibleModalRects();
    expect(rects).toHaveLength(2);
    expect(rects.map((r) => r.width).sort((a, b) => a - b)).toEqual([200, 300]);
  });

  it('excludes Pathfinder content and hidden modals from the scan', () => {
    addDialog({ 'data-pathfinder-content': 'true' });
    addDialog({}, '0');
    expect(getVisibleModalRects()).toHaveLength(0);
  });
});

describe('startModalWatch / stopModalWatch', () => {
  const flush = () => new Promise((r) => setTimeout(r, 5));

  it('emits pathfinder-modal-state-changed when a modal opens and closes', async () => {
    const events: boolean[] = [];
    const handler = (e: Event) => events.push((e as CustomEvent).detail.isOpen);
    document.addEventListener('pathfinder-modal-state-changed', handler);

    startModalWatch();
    const dialog = addDialog();
    await flush();
    expect(events).toContain(true);

    dialog.remove();
    await flush();
    expect(events).toContain(false);

    document.removeEventListener('pathfinder-modal-state-changed', handler);
  });

  it('re-emits when an open modal resizes or moves (geometry signature change)', async () => {
    const events: boolean[] = [];
    const handler = (e: Event) => events.push((e as CustomEvent).detail.isOpen);
    document.addEventListener('pathfinder-modal-state-changed', handler);

    startModalWatch();
    const dialog = addDialog();
    mockRect(dialog, 100, 100, 300, 300);
    await flush();
    expect(events).toEqual([true]);

    mockRect(dialog, 100, 100, 300, 500);
    dialog.style.height = '500px'; // watched attribute mutation triggers a re-check
    await flush();
    expect(events).toEqual([true, true]);

    document.removeEventListener('pathfinder-modal-state-changed', handler);
  });

  it('is refcounted — one stop does not tear down while another caller is active', async () => {
    const events: boolean[] = [];
    const handler = (e: Event) => events.push((e as CustomEvent).detail.isOpen);
    document.addEventListener('pathfinder-modal-state-changed', handler);

    startModalWatch();
    startModalWatch();
    stopModalWatch(); // one of two — still watching

    addDialog();
    await flush();
    expect(events).toContain(true);

    document.removeEventListener('pathfinder-modal-state-changed', handler);
  });
});
