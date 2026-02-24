import React, { useMemo } from 'react';
import { Card, Icon, useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';

import { getStyles } from '../../styles/context-panel.styles';
import { reportAppInteraction, UserInteraction, getContentTypeForAnalytics } from '../../lib/analytics';
import { testIds } from '../../constants/testIds';
import type { PublishedGuide } from '../../utils/usePublishedGuides';

interface CustomGuidesSectionProps {
  guides: PublishedGuide[];
  isLoading: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  openDocsPage: (url: string, title: string) => void;
}

export function CustomGuidesSection({
  guides,
  isLoading,
  expanded,
  onToggleExpanded,
  openDocsPage,
}: CustomGuidesSectionProps) {
  const styles = useStyles2(getStyles);

  const normalizedGuides = useMemo(() => {
    return guides.filter((guide) => guide?.metadata?.name && guide?.spec?.title);
  }, [guides]);

  const openCustomGuide = (guide: PublishedGuide) => {
    const guideUrl = `backend-guide:${guide.metadata.name}`;

    reportAppInteraction(UserInteraction.OpenResourceClick, {
      content_title: guide.spec.title,
      content_url: guideUrl,
      content_type: getContentTypeForAnalytics(guideUrl, 'interactive_guide'),
      interaction_location: 'custom_guides_section',
    });

    openDocsPage(guideUrl, guide.spec.title);
  };

  if (!isLoading && normalizedGuides.length === 0) {
    return null;
  }

  return (
    <div className={styles.customGuidesSection} data-testid={testIds.contextPanel.customGuidesSection}>
      <div className={styles.customGuidesHeader}>
        <button
          onClick={onToggleExpanded}
          className={styles.customGuidesToggle}
          data-testid={testIds.contextPanel.customGuidesToggle}
        >
          <Icon name="rocket" size="sm" />
          <span>{t('contextPanel.customGuides', 'Custom guides')}</span>
          <span className={styles.customGuidesCount}>
            <Icon name="list-ul" size="xs" />
            {t('contextPanel.items', '{{count}} item', { count: normalizedGuides.length })}
          </span>
          <Icon name={expanded ? 'angle-up' : 'angle-down'} size="sm" />
        </button>
      </div>

      {expanded && (
        <div className={styles.customGuidesExpansion}>
          {isLoading ? (
            <div className={styles.customGuidesLoading}>
              {t('contextPanel.loadingCustomGuides', 'Loading guides...')}
            </div>
          ) : (
            <div
              className={`${styles.customGuidesList} ${styles.recommendationsGrid}`}
              data-testid={testIds.contextPanel.customGuidesList}
            >
              {normalizedGuides.map((guide, index) => (
                <Card
                  key={guide.metadata.name}
                  className={`${styles.recommendationCard} ${styles.customGuideCard}`}
                  data-testid={testIds.contextPanel.customGuideItem(index)}
                >
                  <div className={styles.recommendationCardContent}>
                    <div className={styles.cardHeader}>
                      <div className={styles.cardTitleSection}>
                        <h3 className={styles.recommendationCardTitle}>{guide.spec.title}</h3>
                        <span className={styles.customGuideTag}>
                          {t('contextPanel.customGuideTag', 'Custom guide')}
                        </span>
                      </div>
                      <div className={styles.cardActions}>
                        <button onClick={() => openCustomGuide(guide)} className={styles.startButton}>
                          <Icon name="rocket" size="sm" />
                          {t('contextPanel.start', 'Start')}
                        </button>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
