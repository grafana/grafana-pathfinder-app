import { clickToTargetState, commentForTargetState, isAlreadyInTargetState } from './toggle-click';
import { parseTargetState } from '../../lib/dom/toggle-state';

jest.mock('../../lib/logging', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { logger } = jest.requireMock('../../lib/logging');

const waitForReactUpdates = () => Promise.resolve();

/**
 * Models `/dashboard/new`: the "Add" button carries aria-expanded, and its
 * children only exist while it is expanded.
 */
function makeAddDrawer(initiallyOpen: boolean) {
  const root = document.createElement('div');
  const button = document.createElement('button');
  button.setAttribute('data-testid', 'data-testid Dashboard Sidebar new button');
  button.setAttribute('aria-label', 'Add');
  button.setAttribute('aria-expanded', String(initiallyOpen));

  const children = ['data-testid sidebar add new panel', 'data-testid sidebar add new variable button'].map((id) => {
    const child = document.createElement('div');
    child.setAttribute('role', 'button');
    child.setAttribute('data-testid', id);
    return child;
  });

  let clicks = 0;
  const sync = () => {
    const open = button.getAttribute('aria-expanded') === 'true';
    children.forEach((child) => (open ? root.appendChild(child) : child.remove()));
  };

  button.addEventListener('click', () => {
    clicks++;
    button.setAttribute('aria-expanded', button.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
    sync();
  });

  root.appendChild(button);
  sync();
  document.body.appendChild(root);

  return {
    button,
    clicks: () => clicks,
    isOpen: () => button.getAttribute('aria-expanded') === 'true',
    panelTargetPresent: () => root.querySelector('[data-testid="data-testid sidebar add new panel"]') !== null,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  jest.clearAllMocks();
});

describe('clickToTargetState — the Add new element drawer', () => {
  it('does not collapse a drawer that is already open', async () => {
    const drawer = makeAddDrawer(true);

    await clickToTargetState(drawer.button, parseTargetState(true)!, waitForReactUpdates);

    expect(drawer.clicks()).toBe(0);
    expect(drawer.isOpen()).toBe(true);
    expect(drawer.panelTargetPresent()).toBe(true);
  });

  it('opens a drawer that is closed', async () => {
    const drawer = makeAddDrawer(false);
    expect(drawer.panelTargetPresent()).toBe(false);

    await clickToTargetState(drawer.button, parseTargetState(true)!, waitForReactUpdates);

    expect(drawer.clicks()).toBe(1);
    expect(drawer.panelTargetPresent()).toBe(true);
  });

  it('is idempotent — re-running never toggles back', async () => {
    const drawer = makeAddDrawer(false);
    const target = parseTargetState(true)!;

    await clickToTargetState(drawer.button, target, waitForReactUpdates);
    await clickToTargetState(drawer.button, target, waitForReactUpdates);
    await clickToTargetState(drawer.button, target, waitForReactUpdates);

    expect(drawer.clicks()).toBe(1);
    expect(drawer.panelTargetPresent()).toBe(true);
  });

  it('re-opens the drawer after adding a panel auto-closes it', async () => {
    const drawer = makeAddDrawer(true);
    const target = parseTargetState(true)!;

    // Step 1: already open, so nothing to do.
    await clickToTargetState(drawer.button, target, waitForReactUpdates);
    expect(drawer.clicks()).toBe(0);

    // Adding a panel closes the drawer, exactly as Grafana does.
    drawer.button.click();
    expect(drawer.panelTargetPresent()).toBe(false);

    // Step 2 must re-open it.
    await clickToTargetState(drawer.button, target, waitForReactUpdates);
    expect(drawer.panelTargetPresent()).toBe(true);
  });

  it('closes the drawer when the author asks for the off state', async () => {
    const drawer = makeAddDrawer(true);

    await clickToTargetState(drawer.button, parseTargetState(false)!, waitForReactUpdates);

    expect(drawer.isOpen()).toBe(false);
    expect(drawer.panelTargetPresent()).toBe(false);
  });

  it('behaves identically via the explicit attribute form', async () => {
    const open = makeAddDrawer(true);
    await clickToTargetState(open.button, parseTargetState('aria-expanded:true')!, waitForReactUpdates);
    expect(open.clicks()).toBe(0);

    document.body.innerHTML = '';

    const closed = makeAddDrawer(false);
    await clickToTargetState(closed.button, parseTargetState('aria-expanded:true')!, waitForReactUpdates);
    expect(closed.clicks()).toBe(1);
    expect(closed.panelTargetPresent()).toBe(true);
  });
});

describe('clickToTargetState — Grafana Switch', () => {
  function makeSwitch(checked: boolean) {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-testid', 'data-testid prometheus explain switch wrapper');
    const container = document.createElement('div');
    container.setAttribute('data-testid', 'data-testid Switch container');
    const input = document.createElement('input');
    input.setAttribute('role', 'switch');
    input.type = 'checkbox';
    input.checked = checked;
    container.appendChild(input);
    wrapper.appendChild(container);
    document.body.appendChild(wrapper);
    return { wrapper, input };
  }

  it('drives the inner input when the step targets the wrapper', async () => {
    const { wrapper, input } = makeSwitch(false);
    const wrapperClicks = jest.fn();
    wrapper.addEventListener('click', wrapperClicks);

    await clickToTargetState(wrapper, parseTargetState(true)!, waitForReactUpdates);

    expect(input.checked).toBe(true);
    // Clicking the wrapper itself does nothing in Grafana, so the click must
    // have landed on the input and bubbled.
    expect(wrapperClicks).toHaveBeenCalledTimes(1);
  });

  it('leaves an already-on switch alone', async () => {
    const { wrapper, input } = makeSwitch(true);

    await clickToTargetState(wrapper, parseTargetState(true)!, waitForReactUpdates);

    expect(input.checked).toBe(true);
  });
});

describe('commentForTargetState', () => {
  const NOTE = 'Already in the right position';

  const button = (expanded: boolean) => {
    const el = document.createElement('button');
    el.setAttribute('aria-expanded', String(expanded));
    document.body.appendChild(el);
    return el;
  };

  it('leaves the comment alone when there is something to do', () => {
    expect(commentForTargetState('<p>Open it</p>', button(false), true)).toBe('<p>Open it</p>');
  });

  it('leaves the comment alone when no targetState is authored', () => {
    expect(commentForTargetState('<p>Click it</p>', button(true), undefined)).toBe('<p>Click it</p>');
  });

  it('explains above the author comment when nothing needs changing', () => {
    const result = commentForTargetState('<p>Open it</p>', button(true), true)!;

    expect(result).toContain(NOTE);
    expect(result).toContain('<p>Open it</p>');
    expect(result.indexOf(NOTE)).toBeLessThan(result.indexOf('Open it'));
  });

  it('stands alone when the author wrote no comment', () => {
    const result = commentForTargetState(undefined, button(true), true)!;

    expect(result).toContain(NOTE);
  });

  it('says nothing when the state cannot be read, since we still click', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);

    expect(isAlreadyInTargetState(div, true)).toBe(false);
    expect(commentForTargetState('<p>Click it</p>', div, true)).toBe('<p>Click it</p>');
  });

  it('honours the explicitly named attribute form', () => {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-state', 'open');
    wrapper.innerHTML = '<input type="checkbox">';
    document.body.appendChild(wrapper);

    expect(commentForTargetState('<p>Open it</p>', wrapper, 'data-state:open')).toContain(NOTE);
    expect(commentForTargetState('<p>Close it</p>', wrapper, 'data-state:closed')).toBe('<p>Close it</p>');
  });
});

describe('clickToTargetState — explicitly named attribute', () => {
  /**
   * The wrapper carries the author's named attribute and also contains a real
   * control. Reading state on the descended control would miss the attribute
   * entirely and blind-click forever.
   */
  function makeCustomToggle(state: 'open' | 'closed') {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-state', state);
    const inner = document.createElement('input');
    inner.type = 'checkbox';
    wrapper.appendChild(inner);
    let clicks = 0;
    inner.addEventListener('click', () => {
      clicks++;
      wrapper.setAttribute('data-state', wrapper.getAttribute('data-state') === 'open' ? 'closed' : 'open');
    });
    document.body.appendChild(wrapper);
    return { wrapper, clicks: () => clicks, state: () => wrapper.getAttribute('data-state') };
  }

  it('reads the named attribute on the selected element, not a stateful child', async () => {
    const toggle = makeCustomToggle('open');

    await clickToTargetState(toggle.wrapper, parseTargetState('data-state:open')!, waitForReactUpdates);

    expect(toggle.clicks()).toBe(0);
    expect(toggle.state()).toBe('open');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('converges when the named attribute does not yet match', async () => {
    const toggle = makeCustomToggle('closed');

    await clickToTargetState(toggle.wrapper, parseTargetState('data-state:open')!, waitForReactUpdates);

    expect(toggle.clicks()).toBe(1);
    expect(toggle.state()).toBe('open');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('is idempotent across repeated runs', async () => {
    const toggle = makeCustomToggle('closed');
    const target = parseTargetState('data-state:open')!;

    await clickToTargetState(toggle.wrapper, target, waitForReactUpdates);
    await clickToTargetState(toggle.wrapper, target, waitForReactUpdates);
    await clickToTargetState(toggle.wrapper, target, waitForReactUpdates);

    expect(toggle.clicks()).toBe(1);
    expect(toggle.state()).toBe('open');
  });

  it('still finds the attribute when it sits on a descendant', async () => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = '<button aria-expanded="false"></button>';
    const button = wrapper.querySelector('button')!;
    button.addEventListener('click', () => button.setAttribute('aria-expanded', 'true'));
    document.body.appendChild(wrapper);

    await clickToTargetState(wrapper, parseTargetState('aria-expanded:true')!, waitForReactUpdates);

    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('falls back to an unconditional click when the attribute is nowhere', async () => {
    const div = document.createElement('div');
    const onClick = jest.fn();
    div.addEventListener('click', onClick);
    document.body.appendChild(div);

    await clickToTargetState(div, parseTargetState('data-missing:open')!, waitForReactUpdates);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no readable state'), expect.anything());
  });
});

describe('clickToTargetState — unreadable and unresponsive controls', () => {
  it('clicks anyway and warns when the control exposes no state', async () => {
    const div = document.createElement('div');
    const onClick = jest.fn();
    div.addEventListener('click', onClick);
    document.body.appendChild(div);

    await clickToTargetState(div, parseTargetState(true)!, waitForReactUpdates);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no readable state'), expect.anything());
  });

  // Warn rather than throw: blocking would strand the user on a step they
  // cannot pass, and no other handler in the engine fails hard.
  it('warns but does not throw when the click does not move the control', async () => {
    const button = document.createElement('button');
    button.setAttribute('aria-expanded', 'false');
    document.body.appendChild(button);

    await expect(clickToTargetState(button, parseTargetState(true)!, waitForReactUpdates)).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('did not change'), expect.anything());
  });
});
