import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { getUserScope } from '../../lib/user-scope';
import type { Milestone, RawContent } from '../../types/content.types';
import { journeyProgressFromMilestones, type AnalyticsCompletionIdentity } from '../../docs-retrieval';
import { interactiveCompletionStorage } from '../../lib/user-storage';
import { getGuideProgressRevision, subscribeGuideProgressRevision } from '../../global-state/progress-events';
import { guideIdentityAnalyticsProperties, pathAnalytics } from '../../completion-records';
import { AnalyticsContentType, reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { CompletionPanel } from './CompletionPanel';

interface Props {
  content: RawContent;
  completionIdentity?: AnalyticsCompletionIdentity;
  sequence?: { currentMilestone: number; milestones: Milestone[]; baseUrl?: string };
  onContinue?: () => void | Promise<void>;
  celebrating: boolean;
}

const viewed = new Set<string>();

export default function ReaderCompletionPanel({
  content,
  completionIdentity,
  sequence,
  onContinue,
  celebrating,
}: Props) {
  const scope = getUserScope();
  const identityKey = `${scope}:${content.url}`;
  const revision = useSyncExternalStore(
    subscribeGuideProgressRevision,
    getGuideProgressRevision,
    getGuideProgressRevision
  );
  const [path, setPath] = useState<{
    key: string;
    contextKey: string;
    complete: boolean;
  } | null>(null);
  const journey = content.metadata.learningJourney;
  const contextKey = JSON.stringify({
    baseUrl: sequence?.baseUrl ?? journey?.baseUrl ?? content.metadata.trackMemberBaseUrl,
    sequences: [
      sequence?.milestones,
      journey?.milestones,
      ...(journey?.tracks?.map((track) => track.milestones) ?? []),
    ].filter((modules): modules is Milestone[] => Boolean(modules?.length)),
  });
  useEffect(() => {
    let cancelled = false;
    const { baseUrl, sequences } = JSON.parse(contextKey) as { baseUrl?: string; sequences: Milestone[][] };
    if (!baseUrl || sequences.length === 0) {
      return;
    }
    void interactiveCompletionStorage.getAll().then(
      () => {
        if (!cancelled) {
          const complete = sequences.some((modules) => journeyProgressFromMilestones(baseUrl, modules) === 100);
          setPath({ key: identityKey, contextKey, complete });
        }
      },
      () => {
        if (!cancelled) {
          setPath({ key: identityKey, contextKey, complete: false });
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [contextKey, identityKey, revision]);

  const pathComplete = Boolean(path && path.contextKey === contextKey && path.key === identityKey && path.complete);
  const nextModule = onContinue
    ? sequence?.milestones.find((module) => module.number > sequence.currentMilestone && !module.isLocked)
    : undefined;
  const analytics = useCallback(() => {
    const path = pathAnalytics(completionIdentity?.pathIdentity);
    return {
      properties: {
        ...(completionIdentity && guideIdentityAnalyticsProperties({ kind: 'guide', ...completionIdentity })),
        ...path.properties,
        interaction_location: 'content_completion_panel',
        completion_context: sequence ? 'milestone' : 'guide',
      },
      options: path.options,
    };
  }, [completionIdentity, sequence]);
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
    const { properties, options } = analytics();
    reportAppInteraction(UserInteraction.CompletionPanelViewed, properties, options);
  }, [identityKey, analytics]);
  const continueModule = useCallback(async () => {
    const { properties, options } = analytics();
    reportAppInteraction(
      UserInteraction.OpenResourceClick,
      {
        ...properties,
        content_type: AnalyticsContentType.LearningJourney,
        completion_action: 'next_module',
      },
      options
    );
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
      onView={onView}
    />
  );
}
