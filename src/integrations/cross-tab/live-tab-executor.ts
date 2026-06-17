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
import type { CrossTabMessage, StepCommandMessage } from '../../types/cross-tab.types';

interface ExecutorTransport {
  start(): void;
  stop(): void;
  onMessage(listener: (message: CrossTabMessage) => void): () => void;
}

let installed = false;

export function resetLiveTabExecutorForTests(): void {
  installed = false;
}

export function installLiveTabExecutor(
  transport: ExecutorTransport = new CrossTabTransport(createSenderId())
): () => void {
  if (installed || typeof window === 'undefined') {
    return () => undefined;
  }
  installed = true;

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

  const runStepCommand = async (command: StepCommandMessage): Promise<void> => {
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
      console.error('[Pathfinder] cross-tab executor: failed to run remote step', error);
    }
  };

  const unsubscribe = transport.onMessage((message) => {
    if (message.kind === 'step-command') {
      void runStepCommand(message);
    }
  });
  transport.start();

  return () => {
    unsubscribe();
    transport.stop();
    navigationManager.clearAllHighlights();
    installed = false;
  };
}
