import { type ExperimentConfig } from '@grafana-experiments/sdk';
import { config, reportExperimentView } from '@grafana/runtime';
import { loadTranslatedModule } from '../../../lib/plugin-translations';

import {
  HELP_BUTTON_EXPERIMENT_ID,
  HELP_BUTTON_EXPERIMENT_FLAG,
  HELP_BUTTON_CLICK_EVENT,
  HELP_BUTTON_DISMISS_EVENT,
} from '../../../constants/help-button-experiment';
import { sidebarState } from '../../../global-state/sidebar';
import { reportAppInteraction, UserInteraction } from '../../../lib/analytics';
import { StorageKeys } from '../../../lib/storage-keys';
import { createPathfinderExperiments } from '../../../lib/telemetry/experiments';
import { isPathfinderOpen, onPathfinderSurfaceChange } from '../../../lib/telemetry/surface';
import { getFeatureFlagClient } from '../../openfeature';
import { findHelpButton, observeHelpButton, type HelpToolbarTarget } from './controller';
import { showLearnButton } from './learn-button';
import { showHelpButtonTooltip } from './tooltip';
import { getHelpPreviewVariant, showHelpPreviewControls } from './preview';

export const HELP_BUTTON_VARIANTS = ['control', 'learn', 'learn_hint'] as const;

export function isHelpButtonExperimentConfig(value: unknown): value is ExperimentConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'variant' in value &&
    typeof value.variant === 'string' &&
    ['excluded', ...HELP_BUTTON_VARIANTS].includes(value.variant)
  );
}

function createTabFlag(key: string, persist: boolean) {
  let value = false;
  return {
    get: () => {
      if (value || !persist) {
        return value;
      }
      try {
        value = sessionStorage.getItem(key) === 'true';
      } catch {
        // Blocked storage keeps the flag for this page load only.
      }
      return value;
    },
    set: (next: boolean) => {
      value = next;
      if (!persist) {
        return;
      }
      try {
        if (next) {
          sessionStorage.setItem(key, 'true');
        } else {
          sessionStorage.removeItem(key);
        }
      } catch {
        // Blocked storage keeps the flag for this page load only.
      }
    },
  };
}

export async function startHelpButtonExperiment(): Promise<() => void> {
  const previewVariant = getHelpPreviewVariant();
  if (!config.namespace || !config.bootData.user.isSignedIn || config.analytics?.enabled === false) {
    return () => {};
  }
  const { t } = await loadTranslatedModule(() => import('@grafana/i18n'));
  const contextKey = `${config.namespace}:${config.bootData.user.id}`;
  // Core's namespace, so the label matches the rendered Help button in every locale.
  const helpLabel = t('navigation.help.aria-label', 'Help', { ns: 'grafana' });
  const dismissalKey = `${StorageKeys.HELP_BUTTON_ATTENTION_DISMISSED_PREFIX}${contextKey}`;
  const persist = !previewVariant;
  const attentionDismissed = createTabFlag(dismissalKey, persist);
  const tooltipDismissed = createTabFlag(`${dismissalKey}:tooltip`, persist);
  const enrolled = createTabFlag(`${dismissalKey}:enrolled`, persist);
  if (attentionDismissed.get() && !enrolled.get()) {
    return () => {};
  }
  const sdk = createPathfinderExperiments({
    scope: 'grafana-pathfinder-app',
    development: Boolean(previewVariant),
    client: getFeatureFlagClient(),
    recordFlagValue: false,
    contextKey,
    isEnabled: () =>
      config.analytics?.enabled !== false &&
      config.bootData.user.isSignedIn &&
      document.visibilityState === 'visible' &&
      (enrolled.get() || (!isPathfinderOpen() && Boolean(findHelpButton(helpLabel)))) &&
      contextKey === `${config.namespace}:${config.bootData.user.id}`,
    reportExposure: ({ experiment_id, experiment_group, variant }) =>
      reportExperimentView(experiment_id, experiment_group, variant),
    reportAnalytics: (name, properties) => {
      const assignment = sdk?.getActiveAssignments().find((entry) => entry.experiment_id === HELP_BUTTON_EXPERIMENT_ID);
      if (!assignment) {
        return;
      }
      const shared = {
        experiment_help_button_nudge: assignment.variant,
        exposure_id: assignment.exposure_id,
        event_id: String(properties.event_id),
      };
      if (name === HELP_BUTTON_DISMISS_EVENT) {
        reportAppInteraction(UserInteraction.HelpButtonDismissedHint, shared, { mirrorToFaro: false });
      } else {
        reportAppInteraction(
          UserInteraction.HelpButtonClickedToolbar,
          { ...shared, toolbar_target: String(properties.target) },
          { mirrorToFaro: false }
        );
      }
    },
    eventDefinitions: {
      [HELP_BUTTON_CLICK_EVENT]: { version: 2, properties: { target: { type: 'string', required: true } } },
      [HELP_BUTTON_DISMISS_EVENT]: { version: 1, properties: {} },
    },
  });
  if (!sdk) {
    return () => {};
  }
  const experiment = sdk.defineExperiment({
    id: HELP_BUTTON_EXPERIMENT_ID,
    flagKey: HELP_BUTTON_EXPERIMENT_FLAG,
    group: 'closed-help-toolbar',
    flag: { type: 'object', variants: [...HELP_BUTTON_VARIANTS], validate: isHelpButtonExperimentConfig },
  });
  await sdk.ready;
  const observe = () =>
    observeHelpButton({
      experiment,
      helpLabel,
      isOpen: isPathfinderOpen,
      subscribeToOpen: (listener) => onPathfinderSurfaceChange(listener),
      isEnrolled: enrolled.get,
      markEnrolled: () => enrolled.set(true),
      isAttentionDismissed: attentionDismissed.get,
      dismissAttention: () => attentionDismissed.set(true),
      reportClick: (target: HelpToolbarTarget) => sdk.reportAnalytics(HELP_BUTTON_CLICK_EVENT, { target }),
      openLearning: () => {
        if (findHelpButton(helpLabel, false)?.getAttribute('aria-expanded') === 'true') {
          sidebarState.requestCloseSidebar();
          return;
        }
        sidebarState.setPendingOpenSource('help_button_learn');
        sidebarState.openSidebar('Interactive learning');
      },
      showLearnButton: (help, onClick) =>
        showLearnButton(help, config.theme2, t('helpButtonHint.learn', 'Learn'), onClick),
      showTooltip: (anchor, onDismiss) =>
        showHelpButtonTooltip(
          anchor,
          config.theme2,
          {
            message: t('helpButtonHint.message', 'Try interactive learning'),
            dismiss: t('helpButtonHint.dismiss', 'Dismiss learning hint'),
          },
          onDismiss
        ),
      isTooltipDismissed: tooltipDismissed.get,
      dismissTooltip: () => {
        sdk.reportAnalytics(HELP_BUTTON_DISMISS_EVENT);
        tooltipDismissed.set(true);
      },
    });
  if (previewVariant) {
    sdk.development!.setOverride(HELP_BUTTON_EXPERIMENT_ID, { variant: previewVariant });
  }
  let stop = observe();
  const removePreview = previewVariant
    ? showHelpPreviewControls(
        config.theme2,
        previewVariant,
        (variant) => {
          stop();
          attentionDismissed.set(false);
          tooltipDismissed.set(false);
          enrolled.set(false);
          sdk.development!.setOverride(HELP_BUTTON_EXPERIMENT_ID, { variant });
          stop = observe();
        },
        () => {
          if (!enrolled.get() && isPathfinderOpen()) {
            return 'Close interactive learning, then reset the preview.';
          }
          if (!enrolled.get() && attentionDismissed.get()) {
            return 'Dismissed. Reset the preview to show it again.';
          }
          if (document.visibilityState !== 'visible') {
            return 'Waiting for this tab to become visible.';
          }
          if (!findHelpButton(helpLabel, !enrolled.get())) {
            return 'Waiting for the closed desktop Help button.';
          }
          const state = sdk.inspect()[0];
          const attention = enrolled.get() && attentionDismissed.get() ? ' (attention dismissed)' : '';
          return `${state?.status ?? 'inactive'}${state?.reason ? `: ${state.reason}` : ''}${state?.variant ? `: ${state.variant}` : ''}${attention}`;
        }
      )
    : undefined;
  return () => {
    removePreview?.();
    stop();
    sdk.dispose();
  };
}
