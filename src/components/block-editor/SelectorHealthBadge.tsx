/**
 * Selector Health Badge
 *
 * Displays selector quality info (method, score, match count, warnings)
 * below the selector input in the block editor form.
 */

import React, { useMemo } from 'react';
import { Icon, Tooltip, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { querySelectorAllEnhanced } from '../../lib/dom/enhanced-selector';
import { resolveSelector } from '../../lib/dom/selector-resolver';
import { analyzeSelectorString } from '../../lib/dom/selector-generator';
import { useDebouncedValue } from './useDebouncedValue';

interface SelectorHealthBadgeProps {
  reftarget: string;
}

const QUALITY_COLORS: Record<string, string> = {
  good: '#73BF69',
  medium: '#FF9830',
  poor: '#F2495C',
};

interface BadgeInfo {
  method: string;
  stabilityScore: number;
  quality: string;
  matchCount: number;
  warnings: string[];
}

export function SelectorHealthBadge({ reftarget }: SelectorHealthBadgeProps) {
  const styles = useStyles2(getStyles);

  // Debounce the reftarget so DOM queries don't fire on every keystroke
  const debouncedTarget = useDebouncedValue(reftarget, 500);

  const info = useMemo<BadgeInfo | null>(() => {
    if (!debouncedTarget.trim()) {
      return null;
    }

    // Quality/flags/score come from the generator's model so the badge agrees
    // with what the picker would have produced.
    const analysis = analyzeSelectorString(debouncedTarget);
    const allWarnings = [...analysis.warnings];

    let matchCount = 0;
    try {
      const resolved = resolveSelector(debouncedTarget);
      const result = querySelectorAllEnhanced(resolved);
      matchCount = result.elements.length;
    } catch {
      // Selector may be invalid or not resolvable in current page context
    }

    if (matchCount === 0) {
      allWarnings.push('No elements found on this page (may work on the target page)');
    } else if (matchCount > 1) {
      allWarnings.push(`Selector matches ${matchCount} elements; consider making it more specific`);
    }

    return {
      method: analysis.method,
      stabilityScore: analysis.stabilityScore,
      quality: analysis.quality,
      matchCount,
      warnings: allWarnings,
    };
  }, [debouncedTarget]);

  if (!info) {
    return null;
  }

  const dotColor = QUALITY_COLORS[info.quality] ?? QUALITY_COLORS.medium;
  const matchColor = info.matchCount === 1 ? '#73BF69' : info.matchCount === 0 ? '#F2495C' : '#FF9830';

  return (
    <div className={styles.container}>
      <span className={styles.dot} style={{ backgroundColor: dotColor }} />
      <span className={styles.method}>{info.method}</span>
      <span className={styles.score}>{info.stabilityScore}</span>
      <span className={styles.matches} style={{ color: matchColor }}>
        {info.matchCount === 1 ? '1 match' : `${info.matchCount} matches`}
      </span>
      {info.warnings.length > 0 && (
        <Tooltip content={info.warnings.join('. ')}>
          <Icon name="exclamation-triangle" size="sm" className={styles.warningIcon} />
        </Tooltip>
      )}
    </div>
  );
}

SelectorHealthBadge.displayName = 'SelectorHealthBadge';

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    fontSize: theme.typography.bodySmall.fontSize,
    marginTop: theme.spacing(0.5),
  }),
  dot: css({
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  }),
  method: css({
    color: theme.colors.text.secondary,
    fontFamily: theme.typography.fontFamilyMonospace,
  }),
  score: css({
    color: theme.colors.text.primary,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  matches: css({
    fontWeight: theme.typography.fontWeightMedium,
  }),
  warningIcon: css({
    color: theme.colors.warning.text,
    cursor: 'help',
  }),
});
