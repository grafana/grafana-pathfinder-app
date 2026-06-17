import type { InteractiveAction } from './collaboration.types';

export const CROSS_TAB_CHANNEL = 'pathfinder-cross-tab';

export type CrossTabRole = 'controller' | 'live';

interface CrossTabEnvelope {
  source: 'pathfinder';
  senderId: string;
  timestamp: number;
}

export interface StepCommandMessage extends CrossTabEnvelope {
  kind: 'step-command';
  phase: 'show' | 'do';
  stepId: string;
  action: InteractiveAction;
}

export interface HeartbeatMessage extends CrossTabEnvelope {
  kind: 'heartbeat';
  role: CrossTabRole;
}

export type CrossTabMessage = StepCommandMessage | HeartbeatMessage;

export type CrossTabPayload =
  | Omit<StepCommandMessage, keyof CrossTabEnvelope>
  | Omit<HeartbeatMessage, keyof CrossTabEnvelope>;
