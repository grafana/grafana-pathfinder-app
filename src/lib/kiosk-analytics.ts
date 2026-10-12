import { reportAppInteraction, UserInteraction } from './analytics';

let kioskSessionId: string | undefined;
let kioskName: string | undefined;

export function startKioskSession(name = 'unknown'): { id: string; end: () => void } {
  const id = crypto.randomUUID();
  kioskSessionId = id;
  kioskName = name;
  return {
    id,
    end: () => {
      if (kioskSessionId === id) {
        kioskSessionId = undefined;
        kioskName = undefined;
      }
    },
  };
}

export function getKioskSessionId(): string | undefined {
  return kioskSessionId;
}

export function getKioskName(): string | undefined {
  return kioskName;
}

export function setKioskSessionName(sessionId: string, name: string): void {
  if (kioskSessionId === sessionId) {
    kioskName = name;
  }
}

type KioskInteraction =
  | { component: 'kiosk'; action: 'exit'; method: 'button' | 'escape' }
  | { component: 'input'; action: 'change' | 'invalid'; inputType: 'text' | 'datasource'; inputIndex: number }
  | { component: 'launch-form'; action: 'submit' | 'ready' | 'fallback' }
  | { component: 'launch-form'; action: 'error'; reason: 'validation' | 'storage' | 'unavailable' }
  | { component: 'command'; action: 'copy'; outcome: 'success' | 'error' }
  | { component: 'guide-links'; action: 'open_product'; ruleId?: string };

const RULE_ID = /^[a-zA-Z_][a-zA-Z0-9_]{0,99}$/;

export function reportKioskInteraction(
  mode: 'instance' | 'presentation',
  blockIndex: number | undefined,
  interaction: KioskInteraction
) {
  reportAppInteraction(UserInteraction.KioskInteraction, {
    ...(kioskSessionId && { kiosk_session_id: kioskSessionId }),
    ...(kioskName && { kiosk_name: kioskName }),
    launch_mode: mode,
    ...(blockIndex !== undefined && { block_index: blockIndex }),
    component: interaction.component,
    action: interaction.action,
    ...(interaction.component === 'kiosk' && { method: interaction.method }),
    ...(interaction.component === 'input' && {
      input_type: interaction.inputType,
      input_index: interaction.inputIndex,
    }),
    ...(interaction.component === 'launch-form' && interaction.action === 'error' && { reason: interaction.reason }),
    ...(interaction.component === 'command' && { outcome: interaction.outcome }),
    ...(interaction.component === 'guide-links' &&
      interaction.ruleId &&
      RULE_ID.test(interaction.ruleId) && { rule_id: interaction.ruleId }),
  });
}
