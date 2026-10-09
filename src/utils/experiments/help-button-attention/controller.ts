import type { Experiment } from '@grafana-experiments/sdk';

export type HelpToolbarTarget = 'help' | 'learn';

export interface LearnButton {
  element: HTMLButtonElement;
  setAttention: (attention: boolean) => void;
  remove: () => void;
}

interface Options {
  experiment: Experiment;
  helpLabel?: string;
  prepareLearnUI?: () => Promise<void>;
  isOpen: () => boolean;
  subscribeToOpen: (listener: () => void) => () => void;
  isEnrolled: () => boolean;
  markEnrolled: () => void;
  isAttentionDismissed: () => boolean;
  dismissAttention: () => void;
  reportClick: (target: HelpToolbarTarget) => void;
  openLearning: () => void;
  showLearnButton: (help: HTMLButtonElement, onClick: () => void) => LearnButton;
  showTooltip: (anchor: HTMLButtonElement, dismiss: () => void) => () => void;
  isTooltipDismissed: () => boolean;
  dismissTooltip: () => void;
}

export function findHelpButton(helpLabel?: string, requireClosed = true): HTMLButtonElement | undefined {
  const buttons = Array.from(document.querySelectorAll('[data-testid="icon-question-circle"]'))
    .map((icon) => icon.closest('button'))
    .filter((button): button is HTMLButtonElement => {
      const expanded = button?.getAttribute('aria-expanded');
      if (
        !button ||
        button.disabled ||
        (helpLabel !== undefined && button.getAttribute('aria-label') !== helpLabel) ||
        (requireClosed ? expanded !== 'false' : expanded !== 'false' && expanded !== 'true')
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
  let uiReady = !options.prepareLearnUI;
  let uiRequested = false;
  let frame: number | undefined;
  let button: HTMLButtonElement | undefined;
  let learn: LearnButton | undefined;
  let pending: AbortController | undefined;
  let attempted: HTMLButtonElement | undefined;
  let removeTooltip: (() => void) | undefined;
  const hideTooltip = () => {
    removeTooltip?.();
    removeTooltip = undefined;
  };
  const removeLearn = () => {
    hideTooltip();
    learn?.remove();
    learn = undefined;
  };
  const findTarget = () =>
    document.visibilityState === 'visible' ? findHelpButton(options.helpLabel, !options.isEnrolled()) : undefined;

  const detach = () => {
    removeLearn();
    button?.removeEventListener('click', onHelpClick, true);
    button = undefined;
  };
  const endAttention = () => {
    if (!options.isAttentionDismissed()) {
      options.dismissAttention();
    }
    hideTooltip();
    learn?.setAttention(false);
  };
  const toolbarClick = (target: HelpToolbarTarget) => {
    if (!options.isAttentionDismissed() && !options.isOpen()) {
      options.reportClick(target);
    }
    endAttention();
  };
  const onHelpClick = () => {
    if (document.visibilityState === 'visible' && !options.isOpen() && button === findTarget()) {
      toolbarClick('help');
    }
  };
  const onLearnClick = () => {
    toolbarClick('learn');
    options.openLearning();
  };
  const update = () => {
    frame = undefined;
    if (stopped) {
      return;
    }
    if (options.isOpen()) {
      endAttention();
    }
    if (!options.isEnrolled() && options.isAttentionDismissed()) {
      stop();
      return;
    }
    const next = findTarget();
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
      options.markEnrolled();
      button.addEventListener('click', onHelpClick, true);
      if (state.variant === 'control') {
        return;
      }
      if (!uiReady) {
        if (!uiRequested) {
          uiRequested = true;
          void options.prepareLearnUI!().then(
            () => {
              uiReady = true;
              schedule();
            },
            () => stop()
          );
        }
        return;
      }
      if (!learn || !learn.element.isConnected || learn.element.nextElementSibling !== button) {
        removeLearn();
        learn = options.showLearnButton(button, onLearnClick);
      }
      const attention = !options.isAttentionDismissed();
      learn.setAttention(attention);
      if (state.variant === 'learn_hint' && attention && !options.isTooltipDismissed() && !removeTooltip) {
        removeTooltip = options.showTooltip(learn.element, () => {
          options.dismissTooltip();
          hideTooltip();
        });
      }
      return;
    }
    removeLearn();
    button.removeEventListener('click', onHelpClick, true);
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
  };
  const schedule = () => {
    if (
      pending &&
      (document.visibilityState !== 'visible' || (!options.isEnrolled() && options.isOpen()) || button !== findTarget())
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
      endAttention();
    }
    schedule();
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
