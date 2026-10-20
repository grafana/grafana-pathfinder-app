import React, { useState } from 'react';
import { Button, Text, useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { testIds } from '../../constants/testIds';
import { LearningModuleList } from '../LearningContentCard/LearningModuleList';
import type { HubGuide } from './GuideRow';
import { getSidebarHubStyles } from './sidebar-hub.styles';

interface OtherDocsProps {
  guides: HubGuide[];
  onLaunch: (guide: HubGuide) => void | Promise<void>;
}

export function OtherDocs({ guides, onLaunch }: OtherDocsProps) {
  const styles = useStyles2(getSidebarHubStyles);
  const [expanded, setExpanded] = useState(false);

  if (guides.length === 0) {
    return null;
  }
  const title = t('contextPanel.otherDocumentation', 'Other documentation');

  return (
    <section aria-label={title} data-testid={testIds.sidebarHub.otherDocs}>
      <div className={styles.sectionHeader}>
        <Text element="h3" variant="h5">
          <Button
            variant="secondary"
            fill="text"
            size="sm"
            icon={expanded ? 'angle-down' : 'angle-right'}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            data-testid={testIds.sidebarHub.otherDocsToggle}
          >
            {title}
          </Button>
        </Text>
        <Text variant="bodySmall" color="secondary">
          {t('contextPanel.items', '{{count}} items', { count: guides.length })}
        </Text>
      </div>
      {expanded && (
        <div data-testid={testIds.sidebarHub.otherDocsList}>
          <LearningModuleList
            numbered={false}
            itemTestId={testIds.sidebarHub.otherDoc}
            modules={guides.map((guide, index) => ({
              id: String(index),
              title: guide.title,
              url: guide.key,
              number: index + 1,
              isActive: false,
            }))}
            onOpen={(member) => {
              const guide = guides[Number(member.id)];
              return guide && onLaunch(guide);
            }}
          />
        </div>
      )}
    </section>
  );
}
