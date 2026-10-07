import type { Experiment } from '@grafana-experiments/sdk';

interface Options {
  experiment: Experiment;
  helpLabel: string;
  getClassName: () => string;
  isOpen: () => boolean;
  subscribeToOpen: (listener: () => void) => () => void;
  isDismissed: () => boolean;
  dismiss: () => void;
  reportClick: () => void;
  showTooltip: (button: HTMLButtonElement, dismiss: () => void) => () => void;
  isTooltipDismissed: () => boolean;
  dismissTooltip: () => void;
}

export function findHelpButton(helpLabel: string): HTMLButtonElement | undefined {
  const buttons = Array.from(document.querySelectorAll('[data-testid="icon-question-circle"]'))
    .map((icon) => icon.closest('button'))
    .filter((button): button is HTMLButtonElement => {
      if (
        !button ||
        button.disabled ||
        button.getAttribute('aria-label') !== helpLabel ||
        button.getAttribute('aria-expanded') !== 'false'
      ) {
        return false;
      }
      const rect = button.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth &&
        getComputedStyle(button).visibility === 'visible'
      );
    });
  return buttons.length === 1 ? buttons[0] : undefined;
}

export function observeHelpButton(options: Options): () => void {
  let stopped = false;
  let frame: number | undefined;
  let button: HTMLButtonElement | undefined;
  let className: string | undefined;
  let pending: AbortController | undefined;
  let attempted: HTMLButtonElement | undefined;
  let removeTooltip: (() => void) | undefined;
  const hideTooltip = () => {
    removeTooltip?.();
    removeTooltip = undefined;
  };

  const detach = () => {
    hideTooltip();
    if (button) {
      if (className) {
        button.classList.remove(className);
      }
      button.removeEventListener('click', onClick, true);
    }
    button = undefined;
    className = undefined;
  };
  const onClick = () => {
    if (document.visibilityState !== 'visible' || options.isOpen() || button !== findHelpButton(options.helpLabel)) {
      return;
    }
    options.reportClick();
    options.dismiss();
    stop();
  };
  const update = () => {
    frame = undefined;
    if (stopped) {
      return;
    }
    if (options.isOpen() || options.isDismissed()) {
      options.dismiss();
      stop();
      return;
    }
    const next = document.visibilityState === 'visible' ? findHelpButton(options.helpLabel) : undefined;
    if (next !== button) {
      pending?.abort();
      pending = undefined;
      attempted = undefined;
      detach();
      button = next;
    }
    if (!button) {
      return;
    }
    const state = options.experiment.getSnapshot();
    if (state.status === 'excluded') {
      stop();
      return;
    }
    if (state.status === 'active') {
      button.addEventListener('click', onClick, true);
      if (state.variant === 'glow' || state.variant === 'tooltip') {
        const nextClass = options.getClassName();
        if (className !== nextClass) {
          if (className) {
            button.classList.remove(className);
          }
          className = nextClass;
        }
        if (!button.classList.contains(className)) {
          button.classList.add(className);
        }
      }
      if (state.variant === 'tooltip' && !options.isTooltipDismissed() && !removeTooltip) {
        removeTooltip = options.showTooltip(button, () => {
          options.dismissTooltip();
          hideTooltip();
        });
      }
    } else {
      hideTooltip();
      if (className) {
        button.classList.remove(className);
        className = undefined;
      }
      button.removeEventListener('click', onClick, true);
      if (pending || attempted === button) {
        return;
      }
      attempted = button;
      const activation = new AbortController();
      pending = activation;
      void options.experiment
        .activate({ signal: activation.signal })
        .then(() => {
          if (pending === activation) {
            pending = undefined;
            schedule();
          }
        })
        .catch(() => {
          if (pending === activation) {
            pending = undefined;
          }
        });
    }
  };
  const schedule = () => {
    if (
      pending &&
      (document.visibilityState !== 'visible' || options.isOpen() || button !== findHelpButton(options.helpLabel))
    ) {
      pending.abort();
    }
    if (!stopped && frame === undefined) {
      frame = requestAnimationFrame(update);
    }
  };
  const observer = new MutationObserver(schedule);
  const unsubscribeOpen = options.subscribeToOpen(() => {
    if (options.isOpen()) {
      options.dismiss();
      stop();
    } else {
      schedule();
    }
  });
  const unsubscribeExperiment = options.experiment.subscribe(() => {
    if (options.experiment.getSnapshot().status === 'inactive') {
      attempted = undefined;
    }
    schedule();
  });
  const stop = () => {
    stopped = true;
    pending?.abort();
    if (frame !== undefined) {
      cancelAnimationFrame(frame);
    }
    observer.disconnect();
    unsubscribeOpen();
    unsubscribeExperiment();
    document.removeEventListener('visibilitychange', schedule);
    window.removeEventListener('resize', schedule);
    detach();
  };
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-expanded', 'aria-label', 'class', 'style', 'hidden'],
  });
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('resize', schedule);
  schedule();
  return stop;
}
