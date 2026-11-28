import React from 'react';
import { cx } from '@emotion/css';
import { t } from '@grafana/i18n';
import { Button, useStyles2 } from '@grafana/ui';
import { reportAppInteraction, UserInteraction } from '../../../lib/analytics';
import { getContentStyles } from '../../../styles/docs-panel.styles';

export function ReturnToMyLearning({
  courseOverview = false,
  onReturn,
}: {
  courseOverview?: boolean;
  onReturn: () => void;
}) {
  const styles = useStyles2(getContentStyles);
  return (
    <div className={cx(styles.contentFooterAction, courseOverview && styles.courseOverviewFooter)}>
      <Button
        variant="secondary"
        fill="text"
        icon="book-open"
        size="sm"
        onClick={() => {
          reportAppInteraction(UserInteraction.DocsPanelInteraction, {
            action: 'navigate_to_recommendations',
            source: 'content_footer',
          });
          onReturn();
        }}
      >
        {t('docsPanel.returnToMyLearning', 'Return to my learning')}
      </Button>
    </div>
  );
}
