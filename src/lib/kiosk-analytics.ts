import { reportAppInteraction, UserInteraction } from './analytics';

type KioskInteraction =
  | { component: 'kiosk'; action: 'exit'; method: 'button' | 'escape' }
  | { component: 'input'; action: 'change' | 'invalid'; inputType: 'text' | 'datasource'; inputIndex: number }
  | { component: 'launch-form'; action: 'submit' | 'ready' | 'fallback' }
  | { component: 'launch-form'; action: 'error'; reason: 'validation' | 'storage' | 'unavailable' }
  | { component: 'command'; action: 'copy'; outcome: 'success' | 'error' };

export function reportKioskInteraction(
  mode: 'instance' | 'presentation',
  blockIndex: number | undefined,
  interaction: KioskInteraction
) {
  reportAppInteraction(UserInteraction.KioskInteraction, {
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
  });
}
