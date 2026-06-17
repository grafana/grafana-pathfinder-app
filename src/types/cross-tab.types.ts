export const CROSS_TAB_CHANNEL = 'pathfinder-cross-tab';

export type CrossTabRole = 'controller' | 'live';

export interface CrossTabAction {
  targetAction: string;
  refTarget: string;
  targetValue?: string;
  targetComment?: string;
}

interface CrossTabEnvelope {
  source: 'pathfinder';
  senderId: string;
  timestamp: number;
}

export interface StepCommandMessage extends CrossTabEnvelope {
  kind: 'step-command';
  phase: 'show' | 'do';
  stepId: string;
  action: CrossTabAction;
}

export interface HeartbeatMessage extends CrossTabEnvelope {
  kind: 'heartbeat';
  role: CrossTabRole;
}

export interface SidebarHandoffMessage extends CrossTabEnvelope {
  kind: 'sidebar-handoff';
  action: 'close' | 'reopen';
}

export type CrossTabMessage = StepCommandMessage | HeartbeatMessage | SidebarHandoffMessage;

// Distributively strip the envelope from every message kind, so the
// post() payload type stays derived from CrossTabMessage instead of a
// hand-maintained third union that drifts as kinds are added.
export type CrossTabPayload = CrossTabMessage extends infer M
  ? M extends CrossTabEnvelope
    ? Omit<M, keyof CrossTabEnvelope>
    : never
  : never;

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
  if (!isRecord(message.action)) {
    return false;
  }
  const action = message.action;
  return (
    typeof action.refTarget === 'string' &&
    typeof action.targetAction === 'string' &&
    KNOWN_TARGET_ACTIONS.has(action.targetAction)
  );
}

function isValidHeartbeat(message: Record<string, unknown>): boolean {
  return message.role === 'controller' || message.role === 'live';
}

function isValidSidebarHandoff(message: Record<string, unknown>): boolean {
  return message.action === 'close' || message.action === 'reopen';
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
