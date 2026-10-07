import type { Experiment, ExperimentState } from '@grafana-experiments/sdk';
import { observeHelpButton, type LearnButton } from './controller';

type Variant = 'control' | 'learn' | 'learn_hint';

const active = (variant: Variant): ExperimentState => ({
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

const learnButton = () => document.querySelector<HTMLButtonElement>('[data-testid="learn"]');

let stop: () => void;
function setup(variant: Variant = 'learn', { enrolled = false, attentionDismissed = false } = {}) {
  let state: ExperimentState = { status: 'inactive' };
  let open = false;
  let openListener = () => {};
  const flags = { enrolled, attentionDismissed, tooltipDismissed: false };
  const activate = jest.fn(async () => {
    state = active(variant);
    return state;
  });
  const experiment: Experiment = { id: 'test', activate, getSnapshot: () => state, subscribe: () => () => {} };
  const reportClick = jest.fn();
  const openLearning = jest.fn();
  const removeTooltip = jest.fn();
  const showTooltip = jest.fn((_anchor: HTMLButtonElement, _dismiss: () => void) => removeTooltip);
  const dismissTooltip = jest.fn(() => {
    flags.tooltipDismissed = true;
  });
  const showLearnButton = jest.fn((help: HTMLButtonElement, onClick: () => void): LearnButton => {
    const element = document.createElement('button');
    element.dataset.testid = 'learn';
    element.addEventListener('click', onClick);
    help.before(element);
    return {
      element,
      setAttention: (attention) => {
        element.dataset.attention = String(attention);
      },
      remove: () => element.remove(),
    };
  });
  stop = observeHelpButton({
    experiment,
    helpLabel: 'Help',
    isOpen: () => open,
    subscribeToOpen: (fn) => {
      openListener = fn;
      return () => {};
    },
    isEnrolled: () => flags.enrolled,
    markEnrolled: () => {
      flags.enrolled = true;
    },
    isAttentionDismissed: () => flags.attentionDismissed,
    dismissAttention: () => {
      flags.attentionDismissed = true;
    },
    reportClick,
    openLearning,
    showLearnButton,
    showTooltip,
    isTooltipDismissed: () => flags.tooltipDismissed,
    dismissTooltip,
  });
  return {
    flags,
    activate,
    reportClick,
    openLearning,
    showLearnButton,
    showTooltip,
    removeTooltip,
    dismissTooltip,
    setOpen: (next: boolean) => {
      open = next;
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

it('tracks one Help click in control without adding a Learn button or changing the native action', async () => {
  const help = addButton();
  const native = jest.fn();
  help.addEventListener('click', native);
  const runtime = setup('control');
  await frame();
  await frame();
  expect(runtime.activate).toHaveBeenCalledTimes(1);
  expect(learnButton()).toBeNull();
  help.click();
  help.click();
  expect(runtime.reportClick).toHaveBeenCalledTimes(1);
  expect(runtime.reportClick).toHaveBeenCalledWith('help');
  expect(native).toHaveBeenCalledTimes(2);
  expect(runtime.flags.attentionDismissed).toBe(true);
});

it.each(['learn', 'learn_hint'] as const)(
  'adds a sparkling Learn button before Help in %s that stays after it is used',
  async (variant) => {
    const help = addButton();
    const runtime = setup(variant);
    await frame();
    await frame();
    const learn = learnButton()!;
    expect(learn.nextElementSibling).toBe(help);
    expect(learn.dataset.attention).toBe('true');
    learn.click();
    expect(runtime.reportClick).toHaveBeenCalledWith('learn');
    expect(runtime.openLearning).toHaveBeenCalledTimes(1);
    expect(learn.dataset.attention).toBe('false');
    runtime.setOpen(true);
    help.setAttribute('aria-expanded', 'true');
    await frame();
    expect(learnButton()).toBe(learn);
    runtime.setOpen(false);
    help.setAttribute('aria-expanded', 'false');
    await frame();
    learn.click();
    help.click();
    expect(learnButton()).toBe(learn);
    expect(runtime.openLearning).toHaveBeenCalledTimes(2);
    expect(runtime.reportClick).toHaveBeenCalledTimes(1);
  }
);

it('attributes a first Help click in a treatment arm and keeps the Learn button', async () => {
  const help = addButton();
  const runtime = setup('learn');
  await frame();
  await frame();
  help.click();
  expect(runtime.reportClick).toHaveBeenCalledWith('help');
  expect(runtime.openLearning).not.toHaveBeenCalled();
  expect(learnButton()?.dataset.attention).toBe('false');
});

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

it('never enrolls a tab that opened Pathfinder before the Help button was found', async () => {
  const runtime = setup();
  runtime.setOpen(true);
  await frame();
  runtime.setOpen(false);
  addButton();
  await frame();
  await frame();
  expect(runtime.activate).not.toHaveBeenCalled();
  expect(learnButton()).toBeNull();
});

it('ends the sparkle when another route opens Pathfinder and never reports a toolbar click', async () => {
  const help = addButton();
  const runtime = setup();
  await frame();
  await frame();
  runtime.setOpen(true);
  expect(learnButton()?.dataset.attention).toBe('false');
  runtime.setOpen(false);
  await frame();
  help.click();
  learnButton()!.click();
  expect(runtime.reportClick).not.toHaveBeenCalled();
  expect(runtime.openLearning).toHaveBeenCalledTimes(1);
});

it('restores the Learn button without sparkle for a tab that already used it', async () => {
  const help = addButton('true');
  const runtime = setup('learn', { enrolled: true, attentionDismissed: true });
  await frame();
  await frame();
  expect(runtime.activate).toHaveBeenCalledTimes(1);
  expect(learnButton()?.nextElementSibling).toBe(help);
  expect(learnButton()?.dataset.attention).toBe('false');
});

it('handles delayed toolbar mounting and replacement without reactivating', async () => {
  const runtime = setup();
  await frame();
  expect(runtime.activate).not.toHaveBeenCalled();
  const first = addButton();
  await frame();
  await frame();
  expect(learnButton()?.nextElementSibling).toBe(first);
  first.remove();
  const second = addButton();
  await frame();
  expect(document.querySelectorAll('[data-testid="learn"]')).toHaveLength(1);
  expect(learnButton()?.nextElementSibling).toBe(second);
  expect(runtime.activate).toHaveBeenCalledTimes(1);
  learnButton()!.remove();
  await frame();
  expect(learnButton()?.nextElementSibling).toBe(second);
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

it('anchors the hint on Learn, dismisses just the hint, and still attributes a later click', async () => {
  addButton();
  const runtime = setup('learn_hint');
  await frame();
  await frame();
  expect(runtime.showTooltip).toHaveBeenCalledTimes(1);
  expect(runtime.showTooltip.mock.calls[0]![0]).toBe(learnButton());
  runtime.showTooltip.mock.calls[0]![1]();
  await frame();
  expect(runtime.removeTooltip).toHaveBeenCalledTimes(1);
  expect(runtime.dismissTooltip).toHaveBeenCalledTimes(1);
  expect(learnButton()?.dataset.attention).toBe('true');
  expect(runtime.showTooltip).toHaveBeenCalledTimes(1);
  learnButton()!.click();
  expect(runtime.reportClick).toHaveBeenCalledWith('learn');
});

it('removes the hint immediately when another route opens Pathfinder', async () => {
  addButton();
  const runtime = setup('learn_hint');
  await frame();
  await frame();
  runtime.setOpen(true);
  expect(runtime.removeTooltip).toHaveBeenCalledTimes(1);
  expect(runtime.reportClick).not.toHaveBeenCalled();
});

it('removes the Learn button on stop', async () => {
  addButton();
  setup();
  await frame();
  await frame();
  expect(learnButton()).not.toBeNull();
  stop();
  expect(learnButton()).toBeNull();
});
