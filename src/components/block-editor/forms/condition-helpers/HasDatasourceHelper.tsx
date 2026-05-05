/**
 * `HasDatasourceHelper` — argument input for `has-datasource:` and
 * `datasource-configured:` requirements.
 *
 * A plain text input plus a row of clickable suggestion badges
 * populated from `getDataSourceSrv().getList()`. Authors can either type
 * a name/type freehand or click a badge to fill the field. We avoid the
 * Grafana `Combobox` here because its `createCustomValue` mode has
 * surprising autocomplete behaviour that prepends partial matches when
 * the field is re-focused.
 */

import React, { useEffect, useMemo } from 'react';
import { Badge, Input, Stack, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { getDataSourceSrv } from '@grafana/runtime';
import type { ConditionHelperProps } from './types';

interface DatasourceSuggestion {
  value: string;
  description: string;
  /** Whether this suggestion is a datasource name vs a datasource type. */
  kind: 'name' | 'type';
}

function loadSuggestions(): DatasourceSuggestion[] {
  try {
    const sources = getDataSourceSrv().getList();
    const byName: DatasourceSuggestion[] = sources.map((ds) => ({
      value: ds.name,
      description: `Type: ${ds.type}`,
      kind: 'name',
    }));
    const seenTypes = new Set<string>();
    const byType: DatasourceSuggestion[] = [];
    for (const ds of sources) {
      if (!seenTypes.has(ds.type)) {
        seenTypes.add(ds.type);
        byType.push({ value: ds.type, description: 'Match any datasource of this type', kind: 'type' });
      }
    }
    return [...byName, ...byType];
  } catch {
    return [];
  }
}

export function HasDatasourceHelper({ value, onChange, onSubmit, onValidityChange, testId }: ConditionHelperProps) {
  const styles = useStyles2(getStyles);
  const suggestions = useMemo(() => loadSuggestions(), []);

  useEffect(() => {
    onValidityChange?.(value.trim().length > 0);
  }, [value, onValidityChange]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && value.trim().length > 0) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <Stack direction="column" gap={1}>
      <Input
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        onKeyDown={onKeyDown}
        placeholder="e.g., prometheus, loki, mimir"
        autoFocus
        data-testid={testId}
      />
      {suggestions.length > 0 && (
        <div className={styles.suggestionsContainer}>
          <span className={styles.suggestionsLabel}>Click to use one of your datasources:</span>
          <div className={styles.suggestionsList}>
            {suggestions.map((s, i) => (
              <Badge
                // Name and type lists may overlap (rare but possible),
                // so include kind in the key to keep React happy.
                key={`${s.kind}-${s.value}-${i}`}
                text={s.value}
                color={s.kind === 'name' ? 'blue' : 'orange'}
                tooltip={s.description}
                className={styles.suggestionBadge}
                onClick={() => onChange(s.value)}
              />
            ))}
          </div>
        </div>
      )}
    </Stack>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  suggestionsContainer: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
  }),
  suggestionsLabel: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  suggestionsList: css({
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(0.5),
  }),
  suggestionBadge: css({
    cursor: 'pointer',
  }),
});
