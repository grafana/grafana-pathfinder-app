import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { config } from '@grafana/runtime';
import type { Milestone, RawContent } from '../../types/content.types';
import { journeyProgressFromMilestones, type AnalyticsCompletionIdentity } from '../../docs-retrieval';
import { interactiveCompletionStorage } from '../../lib/user-storage';
import { getGuideProgressRevision, subscribeGuideProgressRevision } from '../../global-state/progress-events';
import { guideIdentityAnalyticsProperties, pathAnalyticsProperties } from '../../completion-records';
import { AnalyticsContentType, reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { CompletionPanel } from './CompletionPanel';

interface Props {
  content: RawContent;
  completionIdentity?: AnalyticsCompletionIdentity;
  sequence?: { currentMilestone: number; milestones: Milestone[]; baseUrl?: string };
  onContinue?: () => void | Promise<void>;
  onReview: () => void;
  celebrating: boolean;
}

const viewed = new Set<string>();

export default function ReaderCompletionPanel({
  content,
  completionIdentity,
  sequence,
  onContinue,
  onReview,
  celebrating,
}: Props) {
  const scope = `${config?.namespace ?? ''}:${config?.bootData?.user?.orgId ?? ''}:${config?.bootData?.user?.id ?? ''}`;
  const identityKey = `${scope}:${content.url}`;
  const revision = useSyncExternalStore(
    subscribeGuideProgressRevision,
    getGuideProgressRevision,
    getGuideProgressRevision
  );
  const [path, setPath] = useState<{
    key: string;
    journey: RawContent['metadata']['learningJourney'];
    sequence: Props['sequence'];
    complete: boolean;
  } | null>(null);
  const journey = content.metadata.learningJourney;
  useEffect(() => {
    let cancelled = false;
    const baseUrl = sequence?.baseUrl ?? journey?.baseUrl ?? content.metadata.trackMemberBaseUrl;
    const sequences = [
      sequence?.milestones,
      journey?.milestones,
      ...(journey?.tracks?.map((track) => track.milestones) ?? []),
    ].filter((modules): modules is Milestone[] => Boolean(modules?.length));
    if (!baseUrl || sequences.length === 0) {
      return;
    }
    void interactiveCompletionStorage.getAll().then(
      () => {
        if (!cancelled) {
          const complete = sequences.some((modules) => journeyProgressFromMilestones(baseUrl, modules) === 100);
          setPath({ key: identityKey, journey, sequence, complete });
        }
      },
      () => {
        if (!cancelled) {
          setPath({ key: identityKey, journey, sequence, complete: false });
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [journey, sequence, content.metadata.trackMemberBaseUrl, identityKey, revision]);

  const pathComplete = Boolean(
    path && path.journey === journey && path.sequence === sequence && path.key === identityKey && path.complete
  );
  const nextModule = onContinue
    ? sequence?.milestones.find((module) => module.number > sequence.currentMilestone && !module.isLocked)
    : undefined;
  const analytics = useCallback(
    () => ({
      ...(completionIdentity && {
        ...guideIdentityAnalyticsProperties({ kind: 'guide', ...completionIdentity }),
        ...pathAnalyticsProperties(completionIdentity.pathIdentity),
      }),
      interaction_location: 'content_completion_panel',
      completion_context: sequence ? 'milestone' : 'guide',
    }),
    [completionIdentity, sequence]
  );
  const onView = useCallback(() => {
    if (viewed.has(identityKey)) {
      return;
    }
    if (viewed.size >= 250) {
      const oldest = viewed.values().next().value;
      if (oldest !== undefined) {
        viewed.delete(oldest);
      }
    }
    viewed.add(identityKey);
    reportAppInteraction(UserInteraction.CompletionPanelViewed, analytics());
  }, [identityKey, analytics]);
  const continueModule = useCallback(async () => {
    reportAppInteraction(UserInteraction.OpenResourceClick, {
      ...analytics(),
      content_type: AnalyticsContentType.LearningJourney,
      completion_action: 'next_module',
    });
    await onContinue?.();
  }, [analytics, onContinue]);

  return (
    <CompletionPanel
      key={identityKey}
      content={content}
      completionIdentity={completionIdentity}
      nextModule={nextModule}
      onContinue={onContinue ? continueModule : undefined}
      moduleContext={
        sequence ? { position: sequence.currentMilestone, total: sequence.milestones.length, pathComplete } : undefined
      }
      celebrating={celebrating}
      onReview={onReview}
      onView={onView}
    />
  );
}
