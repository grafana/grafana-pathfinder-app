import React from 'react';
import { Button, useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { useBooleanFlag } from '../../utils/openfeature';
import { openCatalogBrowser, openLearningHome } from '../docs-panel/utils/open-catalog-browser';
import { getCompletionPanelStyles } from './completion-panel.styles';

export function CompletionNavigation({ primaryLearning = false }: { primaryLearning?: boolean }) {
  const styles = useStyles2(getCompletionPanelStyles);
  const browseEnabled = useBooleanFlag('pathfinder.package-browser', true);
  return (
    <div className={styles.footer}>
      <Button
        className={styles.navigationAction}
        variant={primaryLearning ? 'primary' : 'secondary'}
        fill={primaryLearning ? 'solid' : 'text'}
        icon="book-open"
        onClick={() => openLearningHome({ source: 'content_completion_panel' })}
      >
        {t('completionPanel.myLearning', 'My learning')}
      </Button>
      {browseEnabled && (
        <Button
          className={styles.navigationAction}
          variant="secondary"
          fill="text"
          icon="arrow-right"
          onClick={() => openCatalogBrowser({ source: 'content_completion_panel' })}
        >
          {t('completionPanel.exploreShort', 'Explore')}
        </Button>
      )}
    </div>
  );
}
