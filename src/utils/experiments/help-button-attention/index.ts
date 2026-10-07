import { createExperiments, type ExperimentConfig } from '@grafana-experiments/sdk';
import { config, reportExperimentView } from '@grafana/runtime';
import { t } from '@grafana/i18n';

import {
  HELP_BUTTON_EXPERIMENT_ID,
  HELP_BUTTON_EXPERIMENT_FLAG,
  HELP_BUTTON_CLICK_EVENT,
  HELP_BUTTON_DISMISS_EVENT,
} from '../../../constants/help-button-experiment';
import { reportAppInteraction, UserInteraction } from '../../../lib/analytics';
import { StorageKeys } from '../../../lib/storage-keys';
import { getPathfinderFaro } from '../../../lib/telemetry/faro-adapter';
import { isPathfinderOpen, onPathfinderSurfaceChange } from '../../../lib/telemetry/surface';
import { getFeatureFlagClient } from '../../openfeature';
import { findHelpButton, observeHelpButton } from './controller';
import { getHelpButtonAttentionStyle } from './styles';
import { showHelpButtonTooltip } from './tooltip';

export function isHelpButtonExperimentConfig(value: unknown): value is ExperimentConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'variant' in value &&
    typeof value.variant === 'string' &&
    ['excluded', 'control', 'glow', 'tooltip'].includes(value.variant)
  );
}

export async function startHelpButtonExperiment(): Promise<() => void> {
  const faro = getPathfinderFaro();
  if (!faro || !config.namespace || !config.bootData.user.isSignedIn || config.analytics?.enabled === false) {
    return () => {};
  }
  const contextKey = `${config.namespace}:${config.bootData.user.id}`;
  const helpLabel = t('navigation.help.aria-label', 'Help');
  const dismissalKey = `${StorageKeys.HELP_BUTTON_ATTENTION_DISMISSED_PREFIX}${contextKey}`;
  let dismissed = false;
  let tooltipDismissed = false;
  const isDismissed = () => {
    try {
      return dismissed || sessionStorage.getItem(dismissalKey) === 'true';
    } catch {
      return dismissed;
    }
  };
  if (isDismissed()) {
    return () => {};
  }
  const sdk = createExperiments({
    scope: 'grafana-pathfinder-app',
    client: getFeatureFlagClient(),
    faro: { instance: faro },
    recordFlagValue: false,
    contextKey,
    isEnabled: () =>
      config.analytics?.enabled !== false &&
      config.bootData.user.isSignedIn &&
      document.visibilityState === 'visible' &&
      !isPathfinderOpen() &&
      Boolean(findHelpButton(helpLabel)) &&
      contextKey === `${config.namespace}:${config.bootData.user.id}`,
    reportExposure: ({ experiment_id, experiment_group, variant }) =>
      reportExperimentView(experiment_id, experiment_group, variant),
    reportAnalytics: (name, properties) => {
      const assignment = sdk.getActiveAssignments().find((entry) => entry.experiment_id === HELP_BUTTON_EXPERIMENT_ID);
      if (assignment) {
        reportAppInteraction(
          name === HELP_BUTTON_DISMISS_EVENT
            ? UserInteraction.HelpButtonDismissedHint
            : UserInteraction.HelpButtonClickedToolbar,
          {
            experiment_help_button_nudge: assignment.variant,
            exposure_id: assignment.exposure_id,
            event_id: String(properties.event_id),
          },
          { mirrorToFaro: false }
        );
      }
    },
    eventDefinitions: {
      [HELP_BUTTON_CLICK_EVENT]: { version: 1, properties: {} },
      [HELP_BUTTON_DISMISS_EVENT]: { version: 1, properties: {} },
    },
  });
  const experiment = sdk.defineExperiment({
    id: HELP_BUTTON_EXPERIMENT_ID,
    flagKey: HELP_BUTTON_EXPERIMENT_FLAG,
    group: 'closed-help-toolbar',
    flag: { type: 'object', variants: ['control', 'glow', 'tooltip'], validate: isHelpButtonExperimentConfig },
  });
  await sdk.ready;
  const stop = observeHelpButton({
    experiment,
    helpLabel,
    getClassName: () => getHelpButtonAttentionStyle(config.theme2),
    isOpen: isPathfinderOpen,
    subscribeToOpen: (listener) => onPathfinderSurfaceChange(listener),
    isDismissed,
    dismiss: () => {
      dismissed = true;
      try {
        sessionStorage.setItem(dismissalKey, 'true');
      } catch {
        // Blocked storage retains dismissal for this page load.
      }
    },
    reportClick: () => sdk.reportAnalytics(HELP_BUTTON_CLICK_EVENT),
    showTooltip: (button, onDismiss) =>
      showHelpButtonTooltip(
        button,
        config.theme2,
        {
          message: t('helpButtonHint.message', 'Try interactive learning'),
          dismiss: t('helpButtonHint.dismiss', 'Dismiss learning hint'),
        },
        onDismiss
      ),
    isTooltipDismissed: () => {
      try {
        return tooltipDismissed || sessionStorage.getItem(`${dismissalKey}:tooltip`) === 'true';
      } catch {
        return tooltipDismissed;
      }
    },
    dismissTooltip: () => {
      sdk.reportAnalytics(HELP_BUTTON_DISMISS_EVENT);
      tooltipDismissed = true;
      try {
        sessionStorage.setItem(`${dismissalKey}:tooltip`, 'true');
      } catch {
        /* The in-memory dismissal still applies when storage is blocked. */
      }
    },
  });
  return () => {
    stop();
    sdk.dispose();
  };
}
