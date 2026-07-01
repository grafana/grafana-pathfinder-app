import { config, getAppEvents } from '@grafana/runtime';
import { addGlobalInteractiveStyles, updateInteractiveThemeColors } from '../../styles/interactive.styles';
import { waitForReactUpdates } from '../../lib/async-utils';
import { INTERACTIVE_CONFIG } from '../../constants/interactive-config';
import type { InteractiveElementData } from '../../types/interactive.types';
import {
  ButtonHandler,
  FocusHandler,
  FormFillHandler,
  GuidedHandler,
  HoverHandler,
  InteractiveStateManager,
  NavigateHandler,
  NavigationManager,
} from '../../interactive-engine';
import type { GuidedAction } from '../../types/interactive-actions.types';
import { CrossTabTransport, createSenderId } from '../../lib/cross-tab-transport';
import { checkRequirements, dispatchFix, type RequirementsCheckResult } from '../../requirements-manager';
import {
  SIGNED_MESSAGE_KINDS,
  validateCrossTabMessage,
  type CheckRequirementsMessage,
  type CrossTabInternalAction,
  type CrossTabMessage,
  type CrossTabPayload,
  type FixRequirementMessage,
  type RemoteRequirementResult,
  type StepCommandMessage,
} from '../../types/cross-tab.types';
import * as pairingManager from '../../lib/pairing-manager';
import { sidebarState } from '../../global-state/sidebar';
import { isExtensionSidebarOwnedByOther } from '../../lib/storage/extension-sidebar';
import pluginJson from '../../plugin.json';

// The verbs the guided handler can actually drive — narrower than the receive
// gate's KNOWN_TARGET_ACTIONS, so runGuided checks against this before casting.
const GUIDED_VERBS: ReadonlySet<GuidedAction['targetAction']> = new Set([
  'hover',
  'button',
  'highlight',
  'noop',
  'formfill',
]);

interface ExecutorTransport {
  start(): void;
  stop(): void;
  post(payload: CrossTabPayload): void;
  onMessage(listener: (message: CrossTabMessage) => void): () => void;
  getSenderId(): string;
}

interface AuthGate {
  verifySignedMessage(message: pairingManager.SignedMessageFields, ownTabId: string): Promise<boolean>;
  setPendingChallenge(challenge: pairingManager.PendingChallenge): Promise<void> | void;
  setOwnLiveTabId(id: string): void;
  onSessionAccepted(listener: (liveTabId: string) => void): () => void;
}

interface ExecutorPacing {
  showToDoMs: number;
  settleMs: number;
  interStepMs: number;
}

/** @internal Exported for tests so they can pass it with a third authGate arg. */
export const DEFAULT_PACING: ExecutorPacing = {
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
  pacing: ExecutorPacing = DEFAULT_PACING,
  authGate: AuthGate = pairingManager
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
  const guidedHandler = new GuidedHandler(stateManager, navigationManager, waitForReactUpdates);

  // Claim the install slot only after every handler is constructed, so a
  // throwing constructor leaves installed=false and a later init can retry
  // instead of permanently bricking the executor for the session (NEW-1064-1).
  installed = true;

  const ownLiveTabId = transport.getSenderId();
  authGate.setOwnLiveTabId(ownLiveTabId);

  // When the user accepts pairing, post pairing-accept so the controller can
  // bind its liveTabId and start signing commands.
  const unsubscribeAccepted = authGate.onSessionAccepted((liveTabId) => {
    const accepted = pairingManager.getAcceptedSession();
    if (accepted) {
      transport.post({ kind: 'pairing-accept', sessionId: accepted.sessionId });
    }
    void liveTabId;
  });

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

  type ActionList = NonNullable<StepCommandMessage['action']['internalActions']>;
  type OnProgress = (index: number) => void;

  // multi-step / guided replay each internal action the way a live tab paces a
  // normal multi-step: highlight (show) → pause → perform (do) → settle → pause,
  // so the user watches the same staged sequence rather than an instant burst.
  // Composites always run the full show→do sequence; the command's wire `phase`
  // is not consulted (controllers only ever post composites as a 'do').
  const runComposite = async (actions: ActionList, onProgress: OnProgress): Promise<void> => {
    for (let i = 0; i < actions.length; i++) {
      // Paced replay holds the loop open for seconds; bail between actions if a
      // teardown set cancelled so we never touch the DOM post-uninstall (NEW-1064-2).
      if (cancelled) {
        return;
      }
      onProgress(i);
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

  // Guided is human-driven: highlight each target and wait for the user to perform
  // it on the live tab, rather than the auto replay a multi-step uses.
  const runGuided = async (actions: ActionList, onProgress: OnProgress): Promise<boolean> => {
    guidedHandler.resetProgress();
    for (let i = 0; i < actions.length; i++) {
      onProgress(i);
      const action = actions[i]!;
      // The receive gate accepts any KNOWN_TARGET_ACTIONS verb, which is wider than
      // the guided verb set — guard the cast so a non-guided verb (e.g. navigate)
      // fails loud instead of being mistyped into the guided handler (F-1073-nit-cast).
      if (!GUIDED_VERBS.has(action.targetAction as GuidedAction['targetAction'])) {
        console.warn(`[Pathfinder] cross-tab executor: guided step has non-guided verb "${action.targetAction}"`);
        return false;
      }
      const result = await guidedHandler.executeGuidedStep(
        {
          targetAction: action.targetAction as GuidedAction['targetAction'],
          refTarget: action.refTarget,
          targetValue: action.targetValue,
          targetComment: action.targetComment,
        },
        i,
        actions.length
      );
      if (result !== 'completed' && result !== 'skipped') {
        return false;
      }
    }
    return true;
  };

  const runStepCommand = async (command: StepCommandMessage): Promise<void> => {
    if (cancelled) {
      return;
    }
    const { stepId, runId } = command;
    const internalActions = command.action.internalActions;
    const postProgress = (index: number) =>
      transport.post({ kind: 'step-progress', stepId, runId, index, total: internalActions?.length ?? 0 });
    let ok = false;
    try {
      if (internalActions?.length) {
        if (command.action.targetAction === 'guided') {
          ok = await runGuided(internalActions, postProgress);
        } else {
          await runComposite(internalActions, postProgress);
          ok = true;
        }
      } else {
        await runAction(command.action, command.phase === 'show');
        ok = true;
      }
    } catch (error) {
      console.error('[Pathfinder] cross-tab executor: failed to run remote step', error);
      ok = false;
    }
    // Tell the controller whether a composite actually finished, so it surfaces
    // failure instead of completing early. Simple steps stay optimistic by design
    // and report nothing back.
    if (internalActions?.length) {
      transport.post({ kind: 'step-complete', stepId, runId, ok });
    }
  };

  // Evaluate the controller's tab-local requirements against this tab's DOM.
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

  // Run the controller's "Fix this" against this tab's DOM, not the controller's.
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
    // Defense in depth: re-validate at the DOM sink before dispatch.
    const validated = validateCrossTabMessage(message);
    if (!validated) {
      return;
    }

    // Pairing-challenge: controller announces its public key; show the banner.
    if (validated.kind === 'pairing-challenge') {
      void authGate.setPendingChallenge({
        sessionId: validated.sessionId,
        publicKeyB64: validated.publicKeyB64,
        senderTabId: validated.senderId,
        pairingId: validated.pairingId,
        pairingProof: validated.pairingProof,
      });
      return;
    }

    if (validated.kind === 'heartbeat' && validated.role === 'controller') {
      transport.post({ kind: 'heartbeat', role: 'live' });
      return;
    }

    if (SIGNED_MESSAGE_KINDS.has(validated.kind)) {
      void (async () => {
        const authorized = await authGate.verifySignedMessage(validated, ownLiveTabId);
        if (!authorized) {
          return;
        }
        if (validated.kind === 'step-command') {
          queue = queue.then(() => runStepCommand(validated));
        } else if (validated.kind === 'check-requirements') {
          void evaluateRequirements(validated);
        } else if (validated.kind === 'fix-requirement') {
          void runRemoteFix(validated);
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
      })();
    }
  });
  transport.start();

  return () => {
    cancelled = true;
    unsubscribe();
    unsubscribeAccepted();
    transport.stop();
    navigationManager.clearAllHighlights();
    installed = false;
  };
}
