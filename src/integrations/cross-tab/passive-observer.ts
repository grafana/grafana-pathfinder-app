import { nextRequiredAction, advanceActionProgress } from '../../global-state/observation/action-progress';
import { onContextChange } from '../../lib/context-event-bus';
import {
  matchesFormfillState,
  matchesPassiveAction,
  observePassiveActions,
  matchesPassiveNavigation,
  observePassiveNavigation,
} from '../../interactive-engine';
import type {
  ObservationSubscriptionMessage,
  ObservationEvidenceMessage,
  ObservationChangeMessage,
} from '../../types/cross-tab.types';

export function createPassiveObserver(
  post: (
    evidence:
      | Omit<ObservationEvidenceMessage, 'source' | 'senderId' | 'timestamp'>
      | Omit<ObservationChangeMessage, 'source' | 'senderId' | 'timestamp'>
  ) => void,
  paused: () => boolean = () => false
) {
  let subscription: ObservationSubscriptionMessage | undefined;
  let release: (() => void) | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const cancelled = new Set<string>();
  let latest: { session?: string; generation: number; id: string } | undefined;
  const stop = () => {
    release?.();
    release = undefined;
    subscription = undefined;
    clearTimeout(expiry);
  };
  const cancel = (id: string) => {
    cancelled.add(id);
    if (cancelled.size > 256) {
      cancelled.delete(cancelled.values().next().value!);
    }
    if (subscription?.subscriptionId === id) {
      stop();
    }
  };
  const observe = (
    matches: (action: ObservationSubscriptionMessage['steps'][number]['actions'][number]) => boolean
  ) => {
    if (!subscription || paused()) {
      return;
    }
    for (const step of subscription.steps) {
      const index = nextRequiredAction(step.actions, step.cursor);
      const action = step.actions[index];
      if (!action || !matches(action)) {
        continue;
      }
      step.cursor = advanceActionProgress(step.actions, step.cursor, index);
      post({
        kind: 'observation-evidence',
        subscriptionId: subscription.subscriptionId,
        guideKey: subscription.guideKey,
        id: step.id,
        index,
      });
      break;
    }
  };
  const update = (message: ObservationSubscriptionMessage) => {
    if (
      latest &&
      latest.session === message.sessionId &&
      (message.generation < latest.generation ||
        (message.generation === latest.generation && message.subscriptionId !== latest.id))
    ) {
      return;
    }
    latest = { session: message.sessionId, generation: message.generation, id: message.subscriptionId };
    if (cancelled.has(message.subscriptionId)) {
      return;
    }
    if (subscription?.subscriptionId === message.subscriptionId && message.revision < subscription.revision) {
      return;
    }
    const previous = subscription;
    if (previous && previous.subscriptionId !== message.subscriptionId) {
      cancel(previous.subscriptionId);
    }
    subscription = {
      ...message,
      steps: message.steps.map((step) => ({
        ...step,
        cursor: Math.max(
          step.cursor,
          previous?.subscriptionId === message.subscriptionId
            ? (previous.steps.find((old) => old.id === step.id)?.cursor ?? 0)
            : 0
        ),
      })),
    };
    clearTimeout(expiry);
    expiry = setTimeout(stop, 6000);
    if (release) {
      return;
    }
    let pending: ReturnType<typeof setTimeout> | undefined;
    const changed = () => {
      if (pending !== undefined) {
        return;
      }
      pending = setTimeout(() => {
        pending = undefined;
        if (subscription && document.visibilityState !== 'hidden') {
          post({
            kind: 'observation-change',
            subscriptionId: subscription.subscriptionId,
            guideKey: subscription.guideKey,
          });
        }
      }, 50);
    };
    const context = onContextChange(changed);
    document.addEventListener('visibilitychange', changed);
    const events = observePassiveActions(
      (event) => {
        observe((action) => matchesPassiveAction(action, event));
        if (event.type !== 'mouseover') {
          changed();
        }
      },
      (touched) => observe((action) => matchesFormfillState(action, touched))
    );
    const navigation = observePassiveNavigation(() => {
      observe(matchesPassiveNavigation);
      changed();
    });
    release = () => {
      events();
      navigation();
      context();
      clearTimeout(pending);
      document.removeEventListener('visibilitychange', changed);
    };
  };
  return { update, cancel, stop };
}
