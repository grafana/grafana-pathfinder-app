/**
 * Host for the interactive-learning tour, rendered from the docs-panel root.
 *
 * It lives here rather than beside the banner because the tour outlives the context
 * panel: its hand-off step opens a guide tab, which unmounts the banner.
 */

import React, { useCallback, useMemo, useSyncExternalStore } from 'react';
import { t } from '@grafana/i18n';

import { AnalyticsContentType, reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { isGrafanaCloud } from '../../utils/grafana-platform';
import { testIds } from '../../constants/testIds';
import { BubbleTour, type BubbleTourOutcome, type BubbleTourStep } from '../BubbleTour';
import {
  isInteractiveLearningTourOpen,
  stopInteractiveLearningTour,
  subscribeInteractiveLearningTour,
} from './tour-store';

const INTERACTION_LOCATION = 'interactive_learning_banner';

// Both guides share the `grafana-tour` section id and seven highlight steps, so the
// in-guide steps work against either. The Cloud guide's nav targets don't exist in
// OSS, and one of them is neither skippable nor guarded by `exists-reftarget`.
const OSS_GUIDE_URL = 'bundled:welcome-to-grafana';
const CLOUD_GUIDE_URL = 'bundled:welcome-to-grafana-cloud';

// Step ids are content hashes that shift when a guide's blocks are edited or
// reordered, so anchor on the stable button classes instead.
const GUIDE_SECTION = '[data-testid="interactive-section-section-grafana-tour"]';

export interface InteractiveLearningTourProps {
  onOpenGuide: (url: string, title: string) => void;
  onReturnToContext: () => void;
}

export function InteractiveLearningTour({ onOpenGuide, onReturnToContext }: InteractiveLearningTourProps) {
  const isOpen = useSyncExternalStore(
    subscribeInteractiveLearningTour,
    isInteractiveLearningTourOpen,
    isInteractiveLearningTourOpen
  );

  const guideTitle = t('interactiveLearningBanner.guideTitle', 'Welcome to Grafana');

  const openWelcomeGuide = useCallback(() => {
    const guideUrl = isGrafanaCloud() ? CLOUD_GUIDE_URL : OSS_GUIDE_URL;

    // The same event every recommendation card fires, so banner-driven opens sit in
    // the existing funnel; `interaction_location` is what separates them.
    reportAppInteraction(UserInteraction.OpenResourceClick, {
      content_title: guideTitle,
      content_url: guideUrl,
      content_type: AnalyticsContentType.InteractiveGuide,
      interaction_location: INTERACTION_LOCATION,
    });
    onOpenGuide(guideUrl, guideTitle);
  }, [guideTitle, onOpenGuide]);

  const steps = useMemo<BubbleTourStep[]>(
    () => [
      {
        target: `[data-testid="${testIds.contextPanel.container}"]`,
        title: t('interactiveLearningBanner.tour.panelTitle', 'Learning that follows you around'),
        content: t(
          'interactiveLearningBanner.tour.panelBody',
          'This panel stays open beside Grafana while you work, so you practise in the real interface with your own data.'
        ),
      },
      {
        target: `[data-testid="${testIds.contextPanel.recommendationsContainer}"]`,
        title: t('interactiveLearningBanner.tour.recommendationsTitle', 'Suggestions for where you are'),
        content: t(
          'interactiveLearningBanner.tour.recommendationsBody',
          'These guides are picked for the page you are on, so the list changes as you move around Grafana.'
        ),
      },
      {
        target: `[data-testid="${testIds.contextPanel.recommendationCard(0)}"]`,
        title: t('interactiveLearningBanner.tour.cardTitle', 'Every card is a guide'),
        content: t(
          'interactiveLearningBanner.tour.cardBody',
          'Open one and it runs right here, a step at a time. Your progress is saved if you close the panel partway through.'
        ),
      },
      {
        target: `[data-testid="${testIds.contextPanel.customGuidesSection}"]`,
        optional: true,
        title: t('interactiveLearningBanner.tour.privateTitle', 'Guides from your organization'),
        content: t(
          'interactiveLearningBanner.tour.privateBody',
          'Guides your organization has published privately appear here, in among the public ones.'
        ),
      },
      {
        target: `[data-testid="${testIds.docsPanel.myLearningTab}"]`,
        title: t('interactiveLearningBanner.tour.myLearningTitle', 'Where the rest of it lives'),
        content: t(
          'interactiveLearningBanner.tour.myLearningBody',
          'My learning holds every guide you have finished, the badges you have earned, and any learning paths published privately for your organization — including ones not suggested for this page.'
        ),
      },
      {
        target: `[data-testid="${testIds.contextPanel.userProfileBar}"]`,
        title: t('interactiveLearningBanner.tour.progressTitle', 'Your progress at a glance'),
        content: t(
          'interactiveLearningBanner.tour.progressBody',
          'Your badges and streak sit up here, so you can see how far you have got without leaving the page.'
        ),
      },
      {
        target: `[data-testid="${testIds.contextPanel.container}"]`,
        nextLabel: t('interactiveLearningBanner.tour.openLabel', 'Open the guide'),
        onAdvance: openWelcomeGuide,
        title: t('interactiveLearningBanner.tour.handoffTitle', 'Best seen in a real guide'),
        content: t(
          'interactiveLearningBanner.tour.handoffBody',
          'Two buttons do all the work, and they are easier to show than to describe. Open a short guide and we will point them out.'
        ),
      },
      {
        target: `${GUIDE_SECTION} .interactive-step-show-btn`,
        disableBack: true,
        title: t('interactiveLearningBanner.tour.showMeTitle', '"Show me" is always safe'),
        content: t(
          'interactiveLearningBanner.tour.showMeBody',
          'It outlines the exact control the step is talking about and scrolls it into view. Nothing in Grafana changes, so you can look before you act.'
        ),
      },
      {
        target: `${GUIDE_SECTION} .interactive-step-do-btn`,
        nextLabel: t('interactiveLearningBanner.tour.backLabel', 'Take me back'),
        onAdvance: onReturnToContext,
        title: t('interactiveLearningBanner.tour.doItTitle', '"Do it" performs the step'),
        content: t(
          'interactiveLearningBanner.tour.doItBody',
          'Clicks, navigation, and filling in forms all work this way, so you can watch what happens rather than hunt for it.'
        ),
      },
      {
        target: `[data-testid="${testIds.contextPanel.container}"]`,
        disableBack: true,
        title: t('interactiveLearningBanner.tour.finishTitle', 'Back where you started'),
        content: t(
          'interactiveLearningBanner.tour.finishBody',
          'Steps can be repeated, and most can be skipped if they do not apply to you, so go at your own pace. Pick a guide whenever you are ready — the one you just opened is still in its own tab.'
        ),
      },
    ],
    [openWelcomeGuide, onReturnToContext]
  );

  const handleClose = useCallback(({ reason, stepIndex, stepTotal }: BubbleTourOutcome) => {
    stopInteractiveLearningTour();
    reportAppInteraction(
      reason === 'completed'
        ? UserInteraction.InteractiveLearningTourCompleted
        : UserInteraction.InteractiveLearningTourDismissed,
      {
        interaction_location: INTERACTION_LOCATION,
        step_index: stepIndex,
        step_total: stepTotal,
      }
    );
  }, []);

  if (!isOpen) {
    return null;
  }

  return <BubbleTour steps={steps} onClose={handleClose} />;
}
