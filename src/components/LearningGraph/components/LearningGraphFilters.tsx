/**
 * Compact filter bar for the LearningGraph.
 *
 * 5 controls:
 * 1. Edge type toggles (pill buttons: Recommended / Prerequisites / Suggested)
 * 2. Type filter (All / Paths / Guides)
 * 3. Category multi-select pills
 * 4. Completion filter (All / Not started / Completed)
 * 5. "What's next" smart toggle
 */

import React from 'react';
import { useStyles2, Icon } from '@grafana/ui';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import type { GraphEdgeType } from '../../../types/package.types';
import type { GraphFilterState, CompletionFilter, TypeFilter } from '../types';

interface LearningGraphFiltersProps {
  filters: GraphFilterState;
  availableCategories: string[];
  onToggleEdgeType: (edgeType: GraphEdgeType) => void;
  onSetTypeFilter: (typeFilter: TypeFilter) => void;
  onToggleCategory: (category: string) => void;
  onSetCompletionFilter: (filter: CompletionFilter) => void;
  onToggleWhatsNext: () => void;
  onResetFilters: () => void;
}

function getFilterStyles(theme: GrafanaTheme2) {
  return {
    bar: css({
      display: 'flex',
      flexWrap: 'wrap',
      gap: theme.spacing(0.75),
      alignItems: 'center',
      padding: `${theme.spacing(0.75)} ${theme.spacing(1)}`,
      background: theme.colors.background.secondary,
      borderBottom: `1px solid ${theme.colors.border.weak}`,
    }),
    group: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
    }),
    separator: css({
      width: 1,
      height: 16,
      background: theme.colors.border.weak,
      flexShrink: 0,
    }),
    pill: css({
      padding: '2px 8px',
      borderRadius: '12px',
      border: `1px solid ${theme.colors.border.medium}`,
      background: 'none',
      color: theme.colors.text.secondary,
      fontSize: '11px',
      cursor: 'pointer',
      transition: 'all 0.1s ease',
      '&:hover': {
        borderColor: theme.colors.primary.border,
        color: theme.colors.text.primary,
      },
    }),
    pillActive: css({
      background: theme.colors.primary.transparent,
      borderColor: theme.colors.primary.border,
      color: theme.colors.primary.text,
      fontWeight: theme.typography.fontWeightMedium,
    }),
    smartToggle: css({
      padding: '2px 10px',
      borderRadius: '12px',
      border: `1px solid ${theme.colors.warning.border}`,
      background: 'none',
      color: theme.colors.text.secondary,
      fontSize: '11px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      transition: 'all 0.1s ease',
      '&:hover': {
        borderColor: theme.colors.warning.main,
        color: theme.colors.text.primary,
      },
    }),
    smartToggleActive: css({
      background: theme.colors.warning.transparent,
      borderColor: theme.colors.warning.border,
      color: theme.colors.warning.text,
      fontWeight: theme.typography.fontWeightMedium,
    }),
    resetButton: css({
      padding: '2px 6px',
      borderRadius: theme.shape.radius.default,
      border: 'none',
      background: 'none',
      color: theme.colors.text.disabled,
      fontSize: '11px',
      cursor: 'pointer',
      marginLeft: 'auto',
      '&:hover': {
        color: theme.colors.text.secondary,
      },
    }),
  };
}

const EDGE_TYPE_LABELS: Array<{ type: GraphEdgeType; label: string }> = [
  { type: 'recommends', label: 'Recommended' },
  { type: 'depends', label: 'Prerequisites' },
  { type: 'suggests', label: 'Suggested' },
];

const TYPE_FILTERS: Array<{ value: TypeFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'paths', label: 'Paths' },
  { value: 'journeys', label: 'Journeys' },
  { value: 'guides', label: 'Guides' },
];

const COMPLETION_FILTERS: Array<{ value: CompletionFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'not-started', label: 'Not started' },
  { value: 'completed', label: 'Completed' },
];

export function LearningGraphFilters({
  filters,
  availableCategories,
  onToggleEdgeType,
  onSetTypeFilter,
  onToggleCategory,
  onSetCompletionFilter,
  onToggleWhatsNext,
  onResetFilters,
}: LearningGraphFiltersProps) {
  const styles = useStyles2(getFilterStyles);

  return (
    <div className={styles.bar} aria-label="Graph filters">
      {/* 1. Edge type toggles */}
      <div className={styles.group}>
        {EDGE_TYPE_LABELS.map(({ type, label }) => {
          const active = filters.edgeTypes.has(type);
          return (
            <button
              key={type}
              className={[styles.pill, active ? styles.pillActive : ''].filter(Boolean).join(' ')}
              onClick={() => onToggleEdgeType(type)}
              aria-pressed={active}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className={styles.separator} />

      {/* 2. Type filter */}
      <div className={styles.group}>
        {TYPE_FILTERS.map(({ value, label }) => {
          const active = filters.typeFilter === value;
          return (
            <button
              key={value}
              className={[styles.pill, active ? styles.pillActive : ''].filter(Boolean).join(' ')}
              onClick={() => onSetTypeFilter(value)}
              aria-pressed={active}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* 3. Category filter (only shown when categories exist) */}
      {availableCategories.length > 0 && (
        <>
          <div className={styles.separator} />
          <div className={styles.group}>
            {availableCategories.map((cat) => {
              const active = filters.categories.has(cat);
              return (
                <button
                  key={cat}
                  className={[styles.pill, active ? styles.pillActive : ''].filter(Boolean).join(' ')}
                  onClick={() => onToggleCategory(cat)}
                  aria-pressed={active}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className={styles.separator} />

      {/* 4. Completion filter */}
      <div className={styles.group}>
        {COMPLETION_FILTERS.map(({ value, label }) => {
          const active = filters.completionFilter === value;
          return (
            <button
              key={value}
              className={[styles.pill, active ? styles.pillActive : ''].filter(Boolean).join(' ')}
              onClick={() => onSetCompletionFilter(value)}
              aria-pressed={active}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className={styles.separator} />

      {/* 5. What's next smart toggle */}
      <button
        className={[styles.smartToggle, filters.whatsNextMode ? styles.smartToggleActive : '']
          .filter(Boolean)
          .join(' ')}
        onClick={onToggleWhatsNext}
        aria-pressed={filters.whatsNextMode}
        title="Show only guides you're eligible to start next"
      >
        <Icon name="bolt" size="xs" />
        {`What's next`}
      </button>

      {/* Reset */}
      <button className={styles.resetButton} onClick={onResetFilters} title="Reset all filters">
        Reset
      </button>
    </div>
  );
}
