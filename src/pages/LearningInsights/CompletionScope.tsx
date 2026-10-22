import React from 'react';
import { Icon } from '@grafana/ui';
import type { InsightsStyles } from './learning-insights.styles';

export function CompletionScope({ styles: s }: { styles: InsightsStyles }) {
  return (
    <details className={s.scope}>
      <summary>
        <Icon name="info-circle" size="sm" /> About completion counts
      </summary>
      <p>
        Older journey records with unclear guide identity are excluded. Counts cover identifiable guides only. For
        missing guide credit, ask your administrator to check the original records.
      </p>
    </details>
  );
}
