import React, { useEffect, useState } from 'react';
import { Button } from '@grafana/ui';
import { t } from '@grafana/i18n';
import type { CatalogPackage } from '../../types/package-catalog.types';
import type { Milestone } from '../../types/content.types';
import { loadCatalogMembers } from './catalog-members';
import { LearningModuleList } from '../LearningContentCard/LearningModuleList';
import type { CatalogProgress } from '../../learning-paths';

export function CatalogDetails({
  item,
  items,
  scope,
  progress,
}: {
  item: CatalogPackage;
  items: CatalogPackage[];
  scope: string;
  progress: Map<string, CatalogProgress>;
}) {
  const [members, setMembers] = useState<Milestone[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(Boolean(item.memberIds?.length));
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!item.memberIds?.length) {
      return;
    }
    const controller = new AbortController();
    void loadCatalogMembers(item, items, scope, controller.signal)
      .then((resolved) => {
        if (!controller.signal.aborted) {
          setMembers(resolved);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(true);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [item, items, scope, revision]);
  return (
    <div role="region" aria-label={t('packageBrowser.detailsLabel', 'Details for {{title}}', { title: item.title })}>
      {item.memberIds?.length ? (
        <>
          <h4>{t('packageBrowser.modulesTitle', 'Milestones')}</h4>
          {loading && <p role="status">{t('packageBrowser.membersLoading', 'Loading milestones…')}</p>}
          <LearningModuleList
            modules={item.memberIds.map((id, index) => {
              const member = members[index];
              const local = items.find((candidate) => candidate.id === id && candidate.source === item.source);
              return {
                ...member,
                id,
                number: index + 1,
                title: member?.title || local?.title || id,
                url: member?.url || local?.url || '',
                isActive: false,
                description: member?.description || local?.description,
                estimatedMinutes: member?.estimatedMinutes ?? local?.estimatedMinutes,
              };
            })}
            progress={Object.fromEntries(
              items
                .filter((candidate) => candidate.source === item.source)
                .map((candidate) => [candidate.id, progress.get(candidate.key)?.percent ?? 0])
            )}
          />
          {error && (
            <div role="alert">
              <p>{t('packageBrowser.membersError', 'Could not load milestone details.')}</p>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setError(false);
                  setLoading(true);
                  setRevision((value) => value + 1);
                }}
              >
                {t('learningCard.retry', 'Retry')}
              </Button>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
