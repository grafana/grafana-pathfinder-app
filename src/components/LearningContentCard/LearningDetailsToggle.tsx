import React from 'react';
import { cx } from '@emotion/css';
import { Icon, useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { getLearningContentCardStyles } from './learning-content-card.styles';

interface LearningDetailsToggleProps {
  expanded: boolean;
  /** True when the expansion holds more than the description, which changes the default labels. */
  hasDetails: boolean;
  label?: string;
  collapseLabel?: string;
  controls?: string;
  disabled?: boolean;
  subtle?: boolean;
  testId?: string;
  onToggle: () => void;
}

export function LearningDetailsToggle({
  expanded,
  hasDetails,
  label,
  collapseLabel,
  controls,
  disabled,
  subtle,
  testId,
  onToggle,
}: LearningDetailsToggleProps) {
  const styles = useStyles2(getLearningContentCardStyles);

  return (
    <button
      className={cx(styles.disclosure, subtle && styles.disclosureSubtle)}
      aria-expanded={expanded}
      aria-controls={controls}
      disabled={disabled}
      data-testid={testId}
      onClick={onToggle}
    >
      {expanded
        ? collapseLabel ||
          (hasDetails ? t('learningCard.hideDetails', 'Hide details') : t('learningCard.showLess', 'Show less'))
        : label || (hasDetails ? t('learningCard.details', 'Details') : t('learningCard.readMore', 'Read more'))}
      <Icon name={expanded ? 'angle-up' : 'angle-down'} size="sm" />
    </button>
  );
}
