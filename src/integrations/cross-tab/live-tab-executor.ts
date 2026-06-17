import { config, getAppEvents } from '@grafana/runtime';
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
import {
  validateCrossTabMessage,
  type CrossTabMessage,
  type CrossTabPayload,
  type StepCommandMessage,
} from '../../types/cross-tab.types';
import { sidebarState } from '../../global-state/sidebar';
import { isExtensionSidebarOwnedByOther } from '../../utils/experiments/experiment-utils';
import pluginJson from '../../plugin.json';

interface ExecutorTransport {
  start(): void;
  stop(): void;
  post(payload: CrossTabPayload): void;
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

  const runAction = async (
    action: { targetAction: string; refTarget?: string; targetValue?: string; targetComment?: string },
    isShow: boolean
  ): Promise<void> => {
    const data: InteractiveElementData = {
      refTarget: action.refTarget ?? '',
      targetAction: action.targetAction,
      targetValue: action.targetValue,
      targetComment: action.targetComment,
      tagName: 'button',
      textContent: `${isShow ? 'Show me' : 'Do'}: ${action.refTarget ?? ''}`,
      timestamp: Date.now(),
    };

    switch (action.targetAction) {
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
      case 'noop':
        break;
      default:
        console.warn(`[Pathfinder] cross-tab executor: unsupported action "${action.targetAction}"`);
    }
  };

  const runStepCommand = async (command: StepCommandMessage): Promise<void> => {
    if (cancelled) {
      return;
    }
    const isShow = command.phase === 'show';
    // multi-step / guided carry an ordered internalActions sequence; a plain step
    // carries a single action. Replay sequentially so ordering is preserved.
    const actions = command.action.internalActions?.length ? command.action.internalActions : [command.action];
    try {
      for (const action of actions) {
        if (cancelled) {
          return;
        }
        await runAction(action, isShow);
      }
    } catch (error) {
      // TODO(#1073): post a step-complete{ok:false} back so the controller can
      // surface the failure instead of completing optimistically (F-1064-1).
      // The reverse-channel kind does not exist until the round-trip lands.
      console.error('[Pathfinder] cross-tab executor: failed to run remote step', error);
    }
  };

  // Only restore a sidebar this tab actually gave up to a controller.
  let handedOffSidebar = false;

  const unsubscribe = transport.onMessage((message) => {
    // Defense in depth: re-validate at the DOM sink before dispatch, so the
    // executor never trusts a message that bypassed the transport gate (T1).
    const validated = validateCrossTabMessage(message);
    if (!validated) {
      return;
    }
    if (validated.kind === 'step-command') {
      queue = queue.then(() => runStepCommand(validated));
    } else if (validated.kind === 'heartbeat' && validated.role === 'controller') {
      transport.post({ kind: 'heartbeat', role: 'live' });
    } else if (validated.kind === 'sidebar-handoff') {
      if (validated.action === 'close') {
        if (sidebarState.getIsSidebarMounted()) {
          getAppEvents().publish({ type: 'close-extension-sidebar', payload: {} });
          handedOffSidebar = true;
        }
      } else if (validated.action === 'reopen') {
        if (handedOffSidebar && !isExtensionSidebarOwnedByOther(pluginJson.id)) {
          sidebarState.openSidebar('Interactive learning');
        }
        handedOffSidebar = false;
      }
    }
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
