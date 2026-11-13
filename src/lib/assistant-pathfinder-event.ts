import { BusEventWithPayload } from '@grafana/data';

export const ASSISTANT_PATHFINDER_EVENT_TYPE = 'grafana-assistant:pathfinder';

export interface RefreshGuideOperation {
  operation: 'refresh-guide';
  name: string;
}

// Add new operations to this union; consumers ignore operations they do not know.
export type AssistantPathfinderPayload = RefreshGuideOperation;

// Publishers in other bundles define their own class with the same `type`; the bus matches by type string only.
export class AssistantPathfinderEvent extends BusEventWithPayload<AssistantPathfinderPayload> {
  static type = ASSISTANT_PATHFINDER_EVENT_TYPE;
}

const GUIDE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const GUIDE_NAME_MAX_LENGTH = 253;

/** Returns a validated operation from an untrusted payload, or null. Unknown operations and extra fields are ignored. */
export function parseAssistantPathfinderPayload(payload: unknown): { operation: 'refresh-guide'; name: string } | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const { operation, name } = payload as { operation?: unknown; name?: unknown };
  if (operation !== 'refresh-guide') {
    return null;
  }
  if (typeof name !== 'string' || name.length === 0 || name.length > GUIDE_NAME_MAX_LENGTH) {
    return null;
  }
  return GUIDE_NAME_PATTERN.test(name) ? { operation, name } : null;
}
