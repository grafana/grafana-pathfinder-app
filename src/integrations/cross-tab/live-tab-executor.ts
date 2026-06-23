import { config } from '@grafana/runtime';
import { addGlobalInteractiveStyles, updateInteractiveThemeColors } from '../../styles/interactive.styles';
import { waitForReactUpdates } from '../../lib/async-utils';
import type { InteractiveElementData } from '../../types/interactive.types';
import {
  ButtonHandler,
  FocusHandler,
  FormFillHandler,
  HoverHandler,
  InteractiveStateManager,
  NavigateHandler,
  NavigationManager,
} from '../../interactive-engine';
import { CrossTabTransport, createSenderId } from '../../lib/cross-tab-transport';
import { validateCrossTabMessage, type CrossTabMessage, type StepCommandMessage } from '../../types/cross-tab.types';

interface ExecutorTransport {
  start(): void;
  stop(): void;
  onMessage(listener: (message: CrossTabMessage) => void): () => void;
}

let installed = false;

/** @internal Test-only reset of the install-once guard. */
export function resetLiveTabExecutorForTests(): void {
  installed = false;
}

export function installLiveTabExecutor(
  transport: ExecutorTransport = new CrossTabTransport(createSenderId())
): () => void {
  if (installed || typeof window === 'undefined') {
    return () => undefined;
  }

  try {
    addGlobalInteractiveStyles();
    updateInteractiveThemeColors(config.theme2);
  } catch (error) {
    console.warn('[Pathfinder] cross-tab executor: style init failed', error);
  }

  const stateManager = new InteractiveStateManager();
  const navigationManager = new NavigationManager();
  const focusHandler = new FocusHandler(stateManager, navigationManager, waitForReactUpdates);
  const buttonHandler = new ButtonHandler(stateManager, navigationManager, waitForReactUpdates);
  const formFillHandler = new FormFillHandler(stateManager, navigationManager, waitForReactUpdates);
  const navigateHandler = new NavigateHandler(stateManager, waitForReactUpdates);
  const hoverHandler = new HoverHandler(stateManager, navigationManager, waitForReactUpdates);

  // Claim the install slot only after every handler is constructed, so a
  // throwing constructor leaves installed=false and a later init can retry
  // instead of permanently bricking the executor for the session (NEW-1064-1).
  installed = true;

  // Teardown flag: a replay in flight (or queued) must not touch the DOM after
  // uninstall (NEW-1064-2).
  let cancelled = false;
  // Serialize replays onto a single chain so a slow paced replay finishes (or
  // is cancelled) before the next command starts — commands cannot interleave
  // and race on shared highlight state (F-1069-1).
  let queue: Promise<void> = Promise.resolve();

  const runStepCommand = async (command: StepCommandMessage): Promise<void> => {
    if (cancelled) {
      return;
    }
    const isShow = command.phase === 'show';
    const data: InteractiveElementData = {
      refTarget: command.action.refTarget,
      targetAction: command.action.targetAction,
      targetValue: command.action.targetValue,
      targetComment: command.action.targetComment,
      tagName: 'button',
      textContent: `${isShow ? 'Show me' : 'Do'}: ${command.action.refTarget}`,
      timestamp: Date.now(),
    };

    try {
      switch (command.action.targetAction) {
        case 'highlight':
          await focusHandler.execute(data, !isShow);
          break;
        case 'button':
          await buttonHandler.execute(data, !isShow);
          break;
        case 'formfill':
          await formFillHandler.execute(data, !isShow);
          break;
        case 'navigate':
          await navigateHandler.execute(data, !isShow);
          break;
        case 'hover':
          await hoverHandler.execute(data, !isShow);
          break;
        default:
          console.warn(`[Pathfinder] cross-tab executor: unsupported action "${command.action.targetAction}"`);
      }
    } catch (error) {
      // TODO(#1073): post a step-complete{ok:false} back so the controller can
      // surface the failure instead of completing optimistically (F-1064-1).
      // The reverse-channel kind does not exist until the round-trip lands.
      console.error('[Pathfinder] cross-tab executor: failed to run remote step', error);
    }
  };

  const unsubscribe = transport.onMessage((message) => {
    // Defense in depth: re-validate at the DOM sink before dispatch, so the
    // executor never trusts a message that bypassed the transport gate (T1).
    const validated = validateCrossTabMessage(message);
    if (!validated || validated.kind !== 'step-command') {
      return;
    }
    queue = queue.then(() => runStepCommand(validated));
  });
  transport.start();

  return () => {
    cancelled = true;
    unsubscribe();
    transport.stop();
    navigationManager.clearAllHighlights();
    installed = false;
  };
}
