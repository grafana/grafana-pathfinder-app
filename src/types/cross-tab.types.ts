import type { ConditionInput } from './requirements.types';
import type { GuidedAction, GuidedSubstepResult, InternalAction } from './interactive-actions.types';

export const CROSS_TAB_CHANNEL = 'pathfinder-cross-tab';

export type CrossTabRole = 'controller' | 'live';

export type CrossTabInternalAction = InternalAction & Omit<GuidedAction, 'targetAction'>;

export function toCrossTabInternalAction(action: CrossTabInternalAction): CrossTabInternalAction {
  return { ...action };
}

export interface CrossTabAction extends CrossTabInternalAction {
  refTarget: string;
  internalActions?: CrossTabInternalAction[];
  stepTimeout?: number;
  guideId?: string;
  contentKey?: string;
}

interface CrossTabEnvelope {
  source: 'pathfinder';
  senderId: string;
  timestamp: number;
}

type SetsEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

type RequiredKeysOf<T> = { [K in keyof T]-?: Record<never, never> extends Pick<T, K> ? never : K }[keyof T];

/**
 * Both directions of assignability, plus equality of the key set and of the
 * required-key set.
 *
 * Mutual assignability alone is blind to an optional-only difference: a type
 * carrying an extra `foo?` stays mutually assignable with one that lacks it, so
 * an optional wire field could be added on one side only and still compile.
 * Comparing `keyof` catches the added key; comparing the required-key set
 * catches a field that merely changed between required and optional.
 */
export type WireMirrors<A, B> = SetsEqual<A, B> &
  SetsEqual<keyof A, keyof B> &
  SetsEqual<RequiredKeysOf<A>, RequiredKeysOf<B>>;

// Deliberate re-statement (not an alias) of CheckResultError /
// RequirementsCheckResult: this is a wire contract, and the two tabs on a
// channel may run different plugin versions, so the internal type must not be
// able to reshape the wire silently. A compile-time guard in
// cross-tab.types.test.ts forces a conscious update here when they diverge.
export interface RemoteRequirementError {
  verdict?: 'satisfied' | 'unsatisfied' | 'unavailable' | 'invalid';
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
  verdict?: 'satisfied' | 'unsatisfied' | 'unavailable' | 'invalid';
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
  requirements: ConditionInput;
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
  requirements: ConditionInput;
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

export interface StepCompleteMessage extends CrossTabEnvelope {
  kind: 'step-complete';
  stepId: string;
  runId: string;
  ok: boolean;
  substepResults?: GuidedSubstepResult[];
}

export interface StepProgressMessage extends CrossTabEnvelope {
  kind: 'step-progress';
  stepId: string;
  runId: string;
  index: number;
  total: number;
  substepResults?: GuidedSubstepResult[];
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
// is out of scope. Requirement traffic is one concrete case: check-requirements
// can carry array-shaped guide requirements, and fix-requirement carries the
// same ConditionInput shape. Guide objectives stay local to the controller and
// never cross this wire. A dropped check falls back locally after 4s with
// tab-local tokens stripped; a dropped fix returns "No live tab responded", is
// not retried locally, and leaves the step blocked. See
// docs/developer/CROSS_TAB_CONTROLLER.md.

const KNOWN_TARGET_ACTIONS: ReadonlySet<string> = new Set([
  'button',
  'highlight',
  'formfill',
  'navigate',
  'hover',
  'guided',
  'multistep',
]);
const GUIDED_TARGET_ACTIONS: ReadonlySet<string> = new Set(['hover', 'button', 'highlight', 'noop', 'formfill']);
const GUIDED_SUBSTEP_STATUSES: ReadonlySet<string> = new Set(['completed', 'skipped', 'timeout', 'cancelled', 'error']);
const MAX_STEP_TIMEOUT = 2_147_483_647;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasValidEnvelope(message: Record<string, unknown>): boolean {
  return (
    message.source === 'pathfinder' &&
    typeof message.senderId === 'string' &&
    typeof message.timestamp === 'number' &&
    typeof message.kind === 'string'
  );
}

function isOptionalSubstepResults(value: unknown, total?: number): boolean {
  if (value === undefined) {
    return true;
  }
  if (!Array.isArray(value) || (total !== undefined && value.length > total)) {
    return false;
  }
  for (const [index, result] of value.entries()) {
    if (
      !isRecord(result) ||
      result.index !== index ||
      typeof result.action !== 'string' ||
      !GUIDED_TARGET_ACTIONS.has(result.action) ||
      typeof result.status !== 'string' ||
      !GUIDED_SUBSTEP_STATUSES.has(result.status) ||
      typeof result.durationMs !== 'number' ||
      !Number.isFinite(result.durationMs) ||
      result.durationMs < 0
    ) {
      return false;
    }
  }
  return true;
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
    !isValidInternalAction(action, KNOWN_TARGET_ACTIONS) ||
    !isOptionalStepTimeout(action.stepTimeout) ||
    !isOptionalString(action.guideId) ||
    !isOptionalString(action.contentKey)
  ) {
    return false;
  }
  if (action.internalActions !== undefined) {
    if (!Array.isArray(action.internalActions)) {
      return false;
    }
    const verbs = action.targetAction === 'guided' ? GUIDED_TARGET_ACTIONS : KNOWN_TARGET_ACTIONS;
    for (const sub of action.internalActions) {
      if (!isValidInternalAction(sub, verbs)) {
        return false;
      }
    }
  }
  return true;
}

function isValidInternalAction(action: unknown, verbs: ReadonlySet<string>): boolean {
  return (
    isRecord(action) &&
    typeof action.targetAction === 'string' &&
    verbs.has(action.targetAction) &&
    isOptionalString(action.refTarget) &&
    isOptionalString(action.targetValue) &&
    isOptionalString(action.targetComment) &&
    isOptionalTargetState(action.targetState) &&
    (action.requirements === undefined || isBoundedConditionInput(action.requirements)) &&
    isOptionalBoolean(action.isSkippable) &&
    isOptionalString(action.formHint) &&
    isOptionalBoolean(action.validateInput) &&
    isOptionalBoolean(action.lazyRender) &&
    isOptionalString(action.scrollContainer)
  );
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

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

function isOptionalTargetState(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean' || typeof value === 'string';
}

function isOptionalStepTimeout(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_STEP_TIMEOUT)
  );
}

const MAX_PAIRING_FIELD_LENGTH = 512;

// A real guide authors a handful of conditions, each a short token. The
// channel is same-origin and forgeable, and this walk runs before the
// signature gate, so bound both the arity and each element rather than
// iterating whatever a sender supplies.
const MAX_CONDITION_TOKENS = 32;
const MAX_CONDITION_TOKEN_LENGTH = 512;

function isBoundedString(value: unknown, maxLength: number): boolean {
  return typeof value === 'string' && value.length <= maxLength;
}

function isBoundedConditionInput(value: unknown): boolean {
  if (isBoundedString(value, MAX_CONDITION_TOKENS * MAX_CONDITION_TOKEN_LENGTH)) {
    return true;
  }
  return (
    Array.isArray(value) &&
    value.length <= MAX_CONDITION_TOKENS &&
    Array.from(value).every((token) => isBoundedString(token, MAX_CONDITION_TOKEN_LENGTH))
  );
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
    isBoundedConditionInput(message.requirements) &&
    isOptionalString(message.targetAction) &&
    isOptionalString(message.refTarget) &&
    isOptionalString(message.targetValue)
  );
}

function isValidFixRequirement(message: Record<string, unknown>): boolean {
  return (
    typeof message.requestId === 'string' &&
    typeof message.stepId === 'string' &&
    isBoundedConditionInput(message.requirements) &&
    isOptionalString(message.fixType) &&
    isOptionalString(message.targetHref) &&
    isOptionalString(message.scrollContainer)
  );
}

// requirement-result / fix-result are replies the controller feeds into its
// requirements-state path; validate the reply shape so a malformed result can't
// resolve a pending request with garbage.
function isOptionalVerdict(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === 'string' && ['satisfied', 'unsatisfied', 'unavailable', 'invalid'].includes(value))
  );
}

function isValidRequirementResult(message: Record<string, unknown>): boolean {
  if (typeof message.requestId !== 'string' || typeof message.stepId !== 'string' || !isRecord(message.result)) {
    return false;
  }
  const result = message.result;
  return (
    typeof result.requirements === 'string' &&
    isOptionalVerdict(result.verdict) &&
    typeof result.pass === 'boolean' &&
    Array.isArray(result.error) &&
    result.error.every(
      (e) =>
        isRecord(e) &&
        typeof e.requirement === 'string' &&
        isOptionalVerdict(e.verdict) &&
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

function isValidStepComplete(message: Record<string, unknown>): boolean {
  return (
    typeof message.stepId === 'string' &&
    typeof message.runId === 'string' &&
    typeof message.ok === 'boolean' &&
    isOptionalSubstepResults(message.substepResults)
  );
}

function isValidStepProgress(message: Record<string, unknown>): boolean {
  return (
    typeof message.stepId === 'string' &&
    typeof message.runId === 'string' &&
    typeof message.index === 'number' &&
    typeof message.total === 'number' &&
    Number.isSafeInteger(message.index) &&
    Number.isSafeInteger(message.total) &&
    message.index >= 0 &&
    message.total >= 1 &&
    message.index <= message.total &&
    isOptionalSubstepResults(message.substepResults, message.total)
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
