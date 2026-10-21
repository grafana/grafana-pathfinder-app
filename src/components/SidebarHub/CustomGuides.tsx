import React, { useState } from 'react';
import { Button, Text, useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { SkeletonLoader } from '../SkeletonLoader';
import { testIds } from '../../constants/testIds';
import { GuideRow, type HubGuide } from './GuideRow';
import { getSidebarHubStyles } from './sidebar-hub.styles';

// TEMPORARY: org custom guides for parity with the old Recommended tab; delete with custom-guides.tsx.
const COLLAPSED_COUNT = 3;

interface CustomGuidesProps {
  guides: HubGuide[];
  isLoading: boolean;
  onLaunch: (guide: HubGuide) => void;
}

export function CustomGuides({ guides, isLoading, onLaunch }: CustomGuidesProps) {
  const styles = useStyles2(getSidebarHubStyles);
  const [expanded, setExpanded] = useState(false);

  if (isLoading) {
    return (
      <div data-testid={testIds.sidebarHub.customGuidesLoading}>
        <SkeletonLoader type="recommendations" />
      </div>
    );
  }
  if (guides.length === 0) {
    return null;
  }
  const visible = expanded ? guides : guides.slice(0, COLLAPSED_COUNT);

  return (
    <section aria-label={t('contextPanel.customGuides', 'Custom guides')} data-testid={testIds.sidebarHub.customGuides}>
      <div className={styles.sectionHeader}>
        <Text element="h3" variant="h5">
          {t('contextPanel.customGuides', 'Custom guides')}
        </Text>
        <Text variant="bodySmall" color="secondary">
          {t('contextPanel.items', '{{count}} items', { count: guides.length })}
        </Text>
      </div>
      <ul className={styles.list}>
        {visible.map((guide, index) => (
          <GuideRow
            key={guide.key}
            guide={guide}
            testId={testIds.sidebarHub.customRow(index)}
            onLaunch={() => onLaunch(guide)}
          />
        ))}
      </ul>
      {guides.length > COLLAPSED_COUNT && (
        <Button
          variant="secondary"
          fill="text"
          size="sm"
          icon={expanded ? 'angle-up' : 'angle-down'}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          data-testid={testIds.sidebarHub.customGuidesToggle}
        >
          {expanded
            ? t('learningCard.showLess', 'Show less')
            : t('sidebarHub.showAll', 'Show all {{total}}', { total: guides.length })}
        </Button>
      )}
    </section>
  );
}
