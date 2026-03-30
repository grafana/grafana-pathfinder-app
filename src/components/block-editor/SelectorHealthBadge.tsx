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
import { useDebouncedValue } from './useDebouncedValue';

interface SelectorHealthBadgeProps {
  reftarget: string;
}

interface SelectorInfo {
  method: string;
  score: number;
  matchCount: number;
  warnings: string[];
}

function analyzeSelectorPattern(reftarget: string): Omit<SelectorInfo, 'matchCount'> {
  const warnings: string[] = [];
  let method = 'compound';
  let score = 40;

  if (reftarget.includes('data-testid')) {
    method = 'data-testid';
    score = 100;
  } else if (reftarget.includes('aria-label')) {
    method = 'aria-label';
    score = 85;
  } else if (reftarget.includes('#')) {
    method = 'id';
    score = 90;
  } else if (reftarget.includes(':text(') || reftarget.includes(':contains(')) {
    method = 'text';
    score = reftarget.includes(':text(') ? 65 : 55;
    warnings.push('Text-based selectors are fragile and may break if the UI text changes');
  } else if (reftarget.includes(':nth-match') || reftarget.includes(':nth-of-type')) {
    method = 'positional';
    score = reftarget.includes(':nth-match') ? 15 : 25;
    warnings.push('Positional selectors are fragile and may break if the page layout changes');
  }

  if (reftarget.includes(' > ') && reftarget.split(' > ').length > 3) {
    warnings.push('Deep nesting makes the selector fragile');
    score = Math.max(10, score - 15);
  }

  return { method, score, warnings };
}

function getQuality(score: number): { label: string; color: string } {
  if (score >= 80) {
    return { label: 'good', color: '#73BF69' };
  }
  if (score >= 40) {
    return { label: 'medium', color: '#FF9830' };
  }
  return { label: 'poor', color: '#F2495C' };
}

export function SelectorHealthBadge({ reftarget }: SelectorHealthBadgeProps) {
  const styles = useStyles2(getStyles);

  // Debounce the reftarget so DOM queries don't fire on every keystroke
  const debouncedTarget = useDebouncedValue(reftarget, 500);

  const info = useMemo<SelectorInfo | null>(() => {
    if (!debouncedTarget.trim()) {
      return null;
    }

    const analysis = analyzeSelectorPattern(debouncedTarget);
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

    return { method: analysis.method, score: analysis.score, matchCount, warnings: allWarnings };
  }, [debouncedTarget]);

  if (!info) {
    return null;
  }

  const quality = getQuality(info.score);
  const matchColor = info.matchCount === 1 ? '#73BF69' : info.matchCount === 0 ? '#F2495C' : '#FF9830';

  return (
    <div className={styles.container}>
      <span className={styles.dot} style={{ backgroundColor: quality.color }} />
      <span className={styles.method}>{info.method}</span>
      <span className={styles.score}>{info.score}</span>
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
