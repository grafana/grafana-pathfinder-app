export const CROSS_TAB_CHANNEL = 'pathfinder-cross-tab';

export type CrossTabRole = 'controller' | 'live';

export interface CrossTabInternalAction {
  targetAction: string;
  refTarget?: string;
  targetValue?: string;
  targetComment?: string;
}

export interface CrossTabAction {
  targetAction: string;
  refTarget: string;
  targetValue?: string;
  targetComment?: string;
  internalActions?: CrossTabInternalAction[];
}

interface CrossTabEnvelope {
  source: 'pathfinder';
  senderId: string;
  timestamp: number;
}

// Tier-0 structural mirror of requirements-manager's CheckResultError /
// RequirementsCheckResult, so a live-tab result crosses the channel without an
// upward import.
export interface RemoteRequirementError {
  requirement: string;
  pass: boolean;
  error?: string;
  context?: Record<string, unknown> | null;
  canFix?: boolean;
  fixType?: string;
  targetHref?: string;
  scrollContainer?: string;
}

export interface RemoteRequirementResult {
  requirements: string;
  pass: boolean;
  error: RemoteRequirementError[];
}

// Auth fields carried on controller→live side-effecting messages.
// Absent on live→controller replies. The executor auth gate validates their
// presence and checks the ECDSA signature before dispatching.
export interface ControllerAuthFields {
  sig: string;
  sessionId: string;
  liveTabId: string;
  sigTs: number;
  sigNonce: string;
}

export interface StepCommandMessage extends CrossTabEnvelope, Partial<ControllerAuthFields> {
  kind: 'step-command';
  phase: 'show' | 'do';
  stepId: string;
  runId: string;
  action: CrossTabAction;
}

// Controller announces its session public key so the live tab can show a
// pairing prompt. Not side-effecting; unsigned.
export interface PairingChallengeMessage extends CrossTabEnvelope {
  kind: 'pairing-challenge';
  sessionId: string;
  publicKeyB64: string;
  pairingId: string;
  pairingProof: string;
}

// Live tab confirms pairing after user accepts. The senderId in the envelope
// IS the liveTabId the controller will use when signing subsequent commands.
export interface PairingAcceptMessage extends CrossTabEnvelope {
  kind: 'pairing-accept';
  sessionId: string;
  pairingId: string;
  acceptProof: string;
}

export interface HeartbeatMessage extends CrossTabEnvelope {
  kind: 'heartbeat';
  role: CrossTabRole;
}

export interface SidebarHandoffMessage extends CrossTabEnvelope, Partial<ControllerAuthFields> {
  kind: 'sidebar-handoff';
  action: 'close' | 'reopen';
}

// Requirement round-trip (controller → live → controller); requestId correlates
// each reply to its request since several steps may be in flight.
export interface CheckRequirementsMessage extends CrossTabEnvelope, Partial<ControllerAuthFields> {
  kind: 'check-requirements';
  requestId: string;
  stepId: string;
  requirements: string;
  targetAction?: string;
  refTarget?: string;
  targetValue?: string;
}

export interface RequirementResultMessage extends CrossTabEnvelope {
  kind: 'requirement-result';
  requestId: string;
  stepId: string;
  result: RemoteRequirementResult;
}

export interface FixRequirementMessage extends CrossTabEnvelope, Partial<ControllerAuthFields> {
  kind: 'fix-requirement';
  requestId: string;
  stepId: string;
  requirements: string;
  fixType?: string;
  targetHref?: string;
  scrollContainer?: string;
}

export interface FixResultMessage extends CrossTabEnvelope {
  kind: 'fix-result';
  requestId: string;
  stepId: string;
  ok: boolean;
  error?: string;
}

// Live → controller: a composite finished; the controller marks completion only then.
export interface StepCompleteMessage extends CrossTabEnvelope {
  kind: 'step-complete';
  stepId: string;
  runId: string;
  ok: boolean;
}

// Live → controller: which internal action a composite is on, so the controller
// can animate per-step progress while the replay runs on the live tab.
export interface StepProgressMessage extends CrossTabEnvelope {
  kind: 'step-progress';
  stepId: string;
  runId: string;
  index: number;
  total: number;
}

export type CrossTabMessage =
  | StepCommandMessage
  | HeartbeatMessage
  | SidebarHandoffMessage
  | CheckRequirementsMessage
  | RequirementResultMessage
  | FixRequirementMessage
  | FixResultMessage
  | StepCompleteMessage
  | StepProgressMessage
  | PairingChallengeMessage
  | PairingAcceptMessage;

// Distributively strip the envelope from every message kind, so the
// post() payload type stays derived from CrossTabMessage instead of a
// hand-maintained third union that drifts as kinds are added.
export type CrossTabPayload = CrossTabMessage extends infer M
  ? M extends CrossTabEnvelope
    ? Omit<M, keyof CrossTabEnvelope>
    : never
  : never;

// The controller→live message kinds that carry an ECDSA signature. The
// controller signs exactly these before posting and the live-tab executor
// requires a verified signature for exactly these before dispatch, so both
// sides MUST agree — this is the single source of truth they share.
export const SIGNED_MESSAGE_KINDS: ReadonlySet<CrossTabMessage['kind']> = new Set([
  'step-command',
  'check-requirements',
  'fix-requirement',
  'sidebar-handoff',
]);

// Same-build assumption: the controller and live tabs are the same plugin
// build in the same browser/origin/session, so there is no protocol-version
// negotiation. Cross-version compatibility is not a goal; a mismatched build
// is out of scope. See docs/developer/CROSS_TAB_CONTROLLER.md.

// Recognized interactive action verbs. Kept as a literal set (not derived
// from InteractiveAction) so the receive gate stays decoupled from the
// action type — #1063 swaps the wire action to a structural CrossTabAction.
const KNOWN_TARGET_ACTIONS: ReadonlySet<string> = new Set([
  'button',
  'highlight',
  'formfill',
  'navigate',
  'hover',
  'guided',
  'multistep',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasValidEnvelope(message: Record<string, unknown>): boolean {
  return (
    message.source === 'pathfinder' &&
    typeof message.senderId === 'string' &&
    typeof message.timestamp === 'number' &&
    typeof message.kind === 'string'
  );
}

function isValidStepCommand(message: Record<string, unknown>): boolean {
  if (message.phase !== 'show' && message.phase !== 'do') {
    return false;
  }
  if (typeof message.stepId !== 'string') {
    return false;
  }
  if (typeof message.runId !== 'string') {
    return false;
  }
  if (!isRecord(message.action)) {
    return false;
  }
  const action = message.action;
  if (
    typeof action.refTarget !== 'string' ||
    typeof action.targetAction !== 'string' ||
    !KNOWN_TARGET_ACTIONS.has(action.targetAction)
  ) {
    return false;
  }
  // Composite (guided/multistep) steps carry an ordered internalActions
  // sequence; every element is replayed as a DOM action on the live tab, so
  // each must itself carry a recognized verb — validate the whole array, not
  // just the composite envelope (T1 / #1068).
  if (action.internalActions !== undefined) {
    return (
      Array.isArray(action.internalActions) &&
      action.internalActions.every(
        (sub) =>
          isRecord(sub) &&
          typeof sub.targetAction === 'string' &&
          KNOWN_TARGET_ACTIONS.has(sub.targetAction) &&
          isOptionalString(sub.refTarget) &&
          isOptionalString(sub.targetValue) &&
          isOptionalString(sub.targetComment)
      )
    );
  }
  return true;
}

function isValidHeartbeat(message: Record<string, unknown>): boolean {
  return message.role === 'controller' || message.role === 'live';
}

function isValidSidebarHandoff(message: Record<string, unknown>): boolean {
  return message.action === 'close' || message.action === 'reopen';
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

const MAX_PAIRING_FIELD_LENGTH = 512;

function isBoundedString(value: unknown, maxLength: number): boolean {
  return typeof value === 'string' && value.length <= maxLength;
}

// check-requirements / fix-requirement are SIDE-EFFECTING on the live tab —
// the executor runs checkRequirements (DOM/URL probes) and dispatchFix
// (navigation / DOM mutation) against the authenticated document. They are the
// highest-risk surface in the protocol, so the controller-supplied fields that
// flow into those calls are validated field-by-field before dispatch.
function isValidCheckRequirements(message: Record<string, unknown>): boolean {
  return (
    typeof message.requestId === 'string' &&
    typeof message.stepId === 'string' &&
    typeof message.requirements === 'string' &&
    isOptionalString(message.targetAction) &&
    isOptionalString(message.refTarget) &&
    isOptionalString(message.targetValue)
  );
}

function isValidFixRequirement(message: Record<string, unknown>): boolean {
  return (
    typeof message.requestId === 'string' &&
    typeof message.stepId === 'string' &&
    typeof message.requirements === 'string' &&
    isOptionalString(message.fixType) &&
    isOptionalString(message.targetHref) &&
    isOptionalString(message.scrollContainer)
  );
}

// requirement-result / fix-result are replies the controller feeds into its
// requirements-state path; validate the reply shape so a malformed result can't
// resolve a pending request with garbage.
function isValidRequirementResult(message: Record<string, unknown>): boolean {
  if (typeof message.requestId !== 'string' || typeof message.stepId !== 'string' || !isRecord(message.result)) {
    return false;
  }
  const result = message.result;
  return (
    typeof result.requirements === 'string' &&
    typeof result.pass === 'boolean' &&
    Array.isArray(result.error) &&
    result.error.every(
      (e) =>
        isRecord(e) &&
        typeof e.requirement === 'string' &&
        typeof e.pass === 'boolean' &&
        isOptionalString(e.error) &&
        isOptionalString(e.fixType) &&
        isOptionalString(e.targetHref) &&
        isOptionalString(e.scrollContainer) &&
        (e.canFix === undefined || typeof e.canFix === 'boolean')
    )
  );
}

function isValidFixResult(message: Record<string, unknown>): boolean {
  return typeof message.requestId === 'string' && typeof message.stepId === 'string' && typeof message.ok === 'boolean';
}

// step-complete is a live → controller reply: the live tab reports a composite
// finished so the controller can mark completion only when it actually ran. It
// triggers no DOM action, but it resolves a pending awaitStepComplete waiter, so
// validate the shape to keep a malformed reply from completing the wrong step.
function isValidStepComplete(message: Record<string, unknown>): boolean {
  return typeof message.stepId === 'string' && typeof message.runId === 'string' && typeof message.ok === 'boolean';
}

// step-progress is a live → controller reply: the live tab reports which internal
// action a composite is on so the controller can animate progress. It triggers no
// DOM action, but it drives a UI callback keyed by stepId, so validate the shape
// to keep a malformed reply from advancing the wrong step's progress.
function isValidStepProgress(message: Record<string, unknown>): boolean {
  return (
    typeof message.stepId === 'string' &&
    typeof message.runId === 'string' &&
    typeof message.index === 'number' &&
    typeof message.total === 'number' &&
    message.index >= 0 &&
    message.total >= 1 &&
    message.index <= message.total
  );
}

function isValidPairingChallenge(message: Record<string, unknown>): boolean {
  return (
    isBoundedString(message.sessionId, MAX_PAIRING_FIELD_LENGTH) &&
    isBoundedString(message.publicKeyB64, MAX_PAIRING_FIELD_LENGTH) &&
    isBoundedString(message.pairingId, MAX_PAIRING_FIELD_LENGTH) &&
    isBoundedString(message.pairingProof, MAX_PAIRING_FIELD_LENGTH)
  );
}

function isValidPairingAccept(message: Record<string, unknown>): boolean {
  return (
    isBoundedString(message.sessionId, MAX_PAIRING_FIELD_LENGTH) &&
    isBoundedString(message.pairingId, MAX_PAIRING_FIELD_LENGTH) &&
    isBoundedString(message.acceptProof, MAX_PAIRING_FIELD_LENGTH)
  );
}

// Per-kind validators — the single source of truth shared by the transport
// receive gate and the live-tab executor. Same-origin traffic is forgeable
// (the envelope alone proves nothing), so every side-effecting command is
// validated field-by-field against this table before dispatch. Each new
// message kind adds its case here on the branch that introduces it; the
// Record over CrossTabMessage['kind'] makes a missing case a compile error.
const KIND_VALIDATORS: Record<CrossTabMessage['kind'], (message: Record<string, unknown>) => boolean> = {
  'step-command': isValidStepCommand,
  heartbeat: isValidHeartbeat,
  'sidebar-handoff': isValidSidebarHandoff,
  'check-requirements': isValidCheckRequirements,
  'requirement-result': isValidRequirementResult,
  'fix-requirement': isValidFixRequirement,
  'fix-result': isValidFixResult,
  'step-complete': isValidStepComplete,
  'step-progress': isValidStepProgress,
  'pairing-challenge': isValidPairingChallenge,
  'pairing-accept': isValidPairingAccept,
};

/**
 * Validate an inbound channel message against the per-kind table. Returns the
 * narrowed message when the envelope and the kind-specific shape are both
 * well-formed, or null otherwise. This is the authorization boundary for
 * cross-tab traffic — callers must not act on an unvalidated message.
 */
export function validateCrossTabMessage(message: unknown): CrossTabMessage | null {
  if (!isRecord(message) || !hasValidEnvelope(message)) {
    return null;
  }
  const validator = KIND_VALIDATORS[message.kind as CrossTabMessage['kind']];
  if (!validator || !validator(message)) {
    return null;
  }
  return message as unknown as CrossTabMessage;
}
