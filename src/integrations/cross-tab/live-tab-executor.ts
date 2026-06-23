import { config, getAppEvents } from '@grafana/runtime';
import { addGlobalInteractiveStyles, updateInteractiveThemeColors } from '../../styles/interactive.styles';
import { waitForReactUpdates } from '../../lib/async-utils';
import { INTERACTIVE_CONFIG } from '../../constants/interactive-config';
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
import { checkRequirements, dispatchFix, type RequirementsCheckResult } from '../../requirements-manager';
import {
  validateCrossTabMessage,
  type CheckRequirementsMessage,
  type CrossTabInternalAction,
  type CrossTabMessage,
  type CrossTabPayload,
  type FixRequirementMessage,
  type RemoteRequirementResult,
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

interface ExecutorPacing {
  showToDoMs: number;
  settleMs: number;
  interStepMs: number;
}

const DEFAULT_PACING: ExecutorPacing = {
  showToDoMs: INTERACTIVE_CONFIG.delays.multiStep.showToDoIterations * INTERACTIVE_CONFIG.delays.multiStep.baseInterval,
  settleMs: INTERACTIVE_CONFIG.delays.multiStep.settleAfterActionMs,
  interStepMs: INTERACTIVE_CONFIG.delays.multiStep.defaultStepDelay,
};

// F-1056-4: the tier-0 wire mirror (RemoteRequirementResult) and the tier-2 real
// result (RequirementsCheckResult) must stay structurally interchangeable in BOTH
// directions — evaluateRequirements posts the real type as the mirror, and the
// controller reads the mirror back as the real type. Drift in either type makes
// this assignment fail to compile.
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _resultMirrorIsExact: MutuallyAssignable<RemoteRequirementResult, RequirementsCheckResult> = true;
void _resultMirrorIsExact;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Double rAF: one frame to flush the action's state update, a second to let the
// browser paint it, so the next internal action sees a settled DOM.
const settleDom = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

let installed = false;

/** @internal Test-only reset of the install-once guard. */
export function resetLiveTabExecutorForTests(): void {
  installed = false;
}

export function installLiveTabExecutor(
  transport: ExecutorTransport = new CrossTabTransport(createSenderId()),
  pacing: ExecutorPacing = DEFAULT_PACING
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

  const runAction = async (action: CrossTabInternalAction, isShow: boolean): Promise<void> => {
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
      case 'guided':
      case 'multistep':
        // A composite verb reaching runAction means its internalActions were
        // empty/absent — runStepCommand expands them before dispatch, so this
        // is a malformed command, not a directly-executable action.
        console.warn(
          `[Pathfinder] cross-tab executor: composite action "${action.targetAction}" carried no internalActions to replay`
        );
        break;
      default:
        console.warn(`[Pathfinder] cross-tab executor: unsupported action "${action.targetAction}"`);
    }
  };

  // multi-step / guided replay each internal action the way a live tab paces a
  // normal multi-step: highlight (show) → pause → perform (do) → settle → pause,
  // so the user watches the same staged sequence rather than an instant burst.
  // Composites always run the full show→do sequence; the command's wire `phase`
  // is not consulted (controllers only ever post composites as a 'do').
  const runComposite = async (
    actions: NonNullable<StepCommandMessage['action']['internalActions']>
  ): Promise<void> => {
    for (let i = 0; i < actions.length; i++) {
      // Paced replay holds the loop open for seconds; bail between actions if a
      // teardown set cancelled so we never touch the DOM post-uninstall (NEW-1064-2).
      if (cancelled) {
        return;
      }
      const action = actions[i]!;
      await runAction(action, true);
      await sleep(pacing.showToDoMs);
      await runAction(action, false);
      await settleDom();
      await sleep(pacing.settleMs);
      if (i < actions.length - 1) {
        await sleep(pacing.interStepMs);
      }
    }
  };

  const runStepCommand = async (command: StepCommandMessage): Promise<void> => {
    if (cancelled) {
      return;
    }
    const internalActions = command.action.internalActions;
    try {
      if (internalActions?.length) {
        await runComposite(internalActions);
      } else {
        await runAction(command.action, command.phase === 'show');
      }
    } catch (error) {
      // TODO(#1073): post a step-complete{ok:false} back so the controller can
      // surface the failure instead of completing optimistically (F-1064-1).
      // The reverse-channel kind does not exist until the round-trip lands.
      console.error('[Pathfinder] cross-tab executor: failed to run remote step', error);
    }
  };

  // A controller tab can't probe this tab's DOM, so it asks us to evaluate its
  // tab-local requirements here and reply with the same result shape its local
  // checker would have produced.
  const evaluateRequirements = async (message: CheckRequirementsMessage): Promise<void> => {
    try {
      const result = await checkRequirements({
        requirements: message.requirements,
        targetAction: message.targetAction ?? 'button',
        refTarget: message.refTarget ?? '',
        targetValue: message.targetValue,
        stepId: message.stepId,
      });
      transport.post({ kind: 'requirement-result', requestId: message.requestId, stepId: message.stepId, result });
    } catch (error) {
      transport.post({
        kind: 'requirement-result',
        requestId: message.requestId,
        stepId: message.stepId,
        result: {
          requirements: message.requirements,
          pass: false,
          error: [{ requirement: message.requirements, pass: false, error: `${error}` }],
        },
      });
    }
  };

  // A controller's "Fix this" must act on this tab's DOM, not the controller's,
  // so the registry fix runs here against the live navigationManager.
  const runRemoteFix = async (message: FixRequirementMessage): Promise<void> => {
    let ok = false;
    let error: string | undefined;
    try {
      const result = await dispatchFix({
        fixType: message.fixType,
        targetHref: message.targetHref,
        scrollContainer: message.scrollContainer,
        requirements: message.requirements,
        stepId: message.stepId,
        navigationManager,
        fixNavigationRequirements: () => navigationManager.fixNavigationRequirements(),
      });
      ok = result.ok;
      error = result.ok ? undefined : result.error;
    } catch (caught) {
      error = `${caught}`;
    }
    transport.post({ kind: 'fix-result', requestId: message.requestId, stepId: message.stepId, ok, error });
  };

  // Only restore a sidebar this tab actually gave up to a controller.
  let handedOffSidebar = false;

  const unsubscribe = transport.onMessage((message) => {
    // Defense in depth: re-validate at the DOM sink before dispatch, so the
    // executor never trusts a message that bypassed the transport gate (T1).
    // check-requirements and fix-requirement are the highest-risk kinds here —
    // they drive DOM probes and navigation/DOM mutation — so they MUST dispatch
    // off `validated`, never the raw message.
    const validated = validateCrossTabMessage(message);
    if (!validated) {
      return;
    }
    if (validated.kind === 'step-command') {
      queue = queue.then(() => runStepCommand(validated));
    } else if (validated.kind === 'check-requirements') {
      void evaluateRequirements(validated);
    } else if (validated.kind === 'fix-requirement') {
      void runRemoteFix(validated);
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
