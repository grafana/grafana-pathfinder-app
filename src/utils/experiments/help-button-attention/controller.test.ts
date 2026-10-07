import type { Experiment, ExperimentState } from '@grafana-experiments/sdk';
import { observeHelpButton } from './controller';

const active = (variant: 'control' | 'glow' | 'tooltip'): ExperimentState => ({
  status: 'active',
  variant,
  assignment: {
    experiment_id: 'test',
    experiment_group: 'test',
    flag_key: 'test',
    variant,
    session_id: 'session',
    exposure_id: 'exposure',
  },
});

function addButton(expanded: string | null = 'false', label = 'Help') {
  const button = document.createElement('button');
  button.setAttribute('aria-label', label);
  if (expanded !== null) {
    button.setAttribute('aria-expanded', expanded);
  }
  const icon = document.createElement('span');
  icon.dataset.testid = 'icon-question-circle';
  button.append(icon);
  document.body.append(button);
  jest.spyOn(button, 'getBoundingClientRect').mockReturnValue({
    width: 32,
    height: 32,
    top: 10,
    left: 10,
    right: 42,
    bottom: 42,
    x: 10,
    y: 10,
    toJSON: () => ({}),
  });
  return button;
}

async function frame() {
  await Promise.resolve();
  jest.advanceTimersByTime(20);
  await Promise.resolve();
  await Promise.resolve();
}

let stop: () => void;
function setup(variant: 'control' | 'glow' | 'tooltip' = 'glow') {
  let state: ExperimentState = { status: 'inactive' };
  let open = false;
  let openListener = () => {};
  const activate = jest.fn(async () => {
    state = active(variant);
    return state;
  });
  const experiment: Experiment = { id: 'test', activate, getSnapshot: () => state, subscribe: () => () => {} };
  const reportClick = jest.fn();
  const dismiss = jest.fn();
  const getClassName = jest.fn(() => 'glow');
  const removeTooltip = jest.fn();
  const showTooltip = jest.fn((_button: HTMLButtonElement, _dismiss: () => void) => removeTooltip);
  let tooltipDismissed = false;
  const dismissTooltip = jest.fn(() => {
    tooltipDismissed = true;
  });
  stop = observeHelpButton({
    experiment,
    helpLabel: 'Help',
    getClassName,
    isOpen: () => open,
    subscribeToOpen: (fn) => {
      openListener = fn;
      return () => {};
    },
    isDismissed: () => false,
    showTooltip,
    isTooltipDismissed: () => tooltipDismissed,
    dismissTooltip,
    dismiss,
    reportClick,
  });
  return {
    showTooltip,
    removeTooltip,
    dismissTooltip,
    activate,
    reportClick,
    dismiss,
    getClassName,
    open: () => {
      open = true;
      openListener();
    },
  };
}

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  stop?.();
  document.body.replaceChildren();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it.each(['control', 'glow', 'tooltip'] as const)(
  'tracks one click in %s without changing the native action',
  async (variant) => {
    const button = addButton();
    const native = jest.fn();
    button.addEventListener('click', native);
    const runtime = setup(variant);
    await frame();
    await frame();
    expect(runtime.activate).toHaveBeenCalledTimes(1);
    expect(button.classList.contains('glow')).toBe(variant === 'glow');
    button.click();
    button.click();
    expect(runtime.reportClick).toHaveBeenCalledTimes(1);
    expect(native).toHaveBeenCalledTimes(2);
    expect(button.className).toBe('');
    expect(runtime.dismiss).toHaveBeenCalledTimes(1);
  }
);

it.each([null, 'true'])('does not enroll dropdown or already-open buttons (%s)', async (expanded) => {
  addButton(expanded);
  const runtime = setup();
  await frame();
  expect(runtime.activate).not.toHaveBeenCalled();
});

it('does not enroll hidden, offscreen or ambiguous buttons', async () => {
  const button = addButton();
  button.style.visibility = 'hidden';
  const runtime = setup();
  await frame();
  expect(runtime.activate).not.toHaveBeenCalled();
  button.style.visibility = 'visible';
  const other = addButton();
  await frame();
  expect(runtime.activate).not.toHaveBeenCalled();
  other.remove();
  jest.mocked(button.getBoundingClientRect).mockReturnValue({ ...button.getBoundingClientRect(), top: 10000 });
  await frame();
  expect(runtime.activate).not.toHaveBeenCalled();
});

it('cleans up on opening by another route and never reports a help click', async () => {
  const button = addButton();
  const runtime = setup();
  await frame();
  await frame();
  runtime.open();
  await frame();
  expect(button.className).toBe('');
  button.click();
  expect(runtime.reportClick).not.toHaveBeenCalled();
  expect(runtime.dismiss).toHaveBeenCalledTimes(1);
});

it('handles delayed toolbar mounting and replacement without reactivating', async () => {
  const runtime = setup();
  await frame();
  expect(runtime.activate).not.toHaveBeenCalled();
  const first = addButton();
  await frame();
  await frame();
  first.remove();
  const second = addButton();
  await frame();
  expect(first.className).toBe('');
  expect(second.className).toBe('glow');
  expect(runtime.activate).toHaveBeenCalledTimes(1);
  second.className = '';
  await frame();
  expect(second.className).toBe('glow');
});

it('aborts activation when the target disappears', async () => {
  const button = addButton();
  const runtime = setup();
  runtime.activate.mockImplementation(() => new Promise(() => {}));
  await frame();
  const options = (runtime.activate.mock.calls as unknown as Array<[{ signal: AbortSignal }]>)[0]![0];
  button.remove();
  await frame();
  expect(options.signal.aborted).toBe(true);
  expect(runtime.reportClick).not.toHaveBeenCalled();
});

it('keeps the glow on a replacement toolbar after the initial four seconds', async () => {
  const first = addButton();
  setup();
  await frame();
  await frame();
  expect(first).toHaveClass('glow');
  jest.advanceTimersByTime(4100);
  await frame();
  first.remove();
  const replacement = addButton();
  await frame();
  expect(replacement).toHaveClass('glow');
});

it('dismisses just the tooltip and still attributes a later Help click', async () => {
  const button = addButton();
  const runtime = setup('tooltip');
  await frame();
  await frame();
  expect(runtime.showTooltip).toHaveBeenCalledTimes(1);
  expect(button.className).toBe('');
  runtime.showTooltip.mock.calls[0]![1]();
  await frame();
  expect(runtime.removeTooltip).toHaveBeenCalledTimes(1);
  expect(runtime.dismissTooltip).toHaveBeenCalledTimes(1);
  expect(runtime.showTooltip).toHaveBeenCalledTimes(1);
  expect(runtime.reportClick).not.toHaveBeenCalled();
  button.click();
  expect(runtime.reportClick).toHaveBeenCalledTimes(1);
});

it('removes the tooltip immediately when another route opens Pathfinder', async () => {
  addButton();
  const runtime = setup('tooltip');
  await frame();
  await frame();
  runtime.open();
  expect(runtime.removeTooltip).toHaveBeenCalledTimes(1);
  expect(runtime.reportClick).not.toHaveBeenCalled();
});
