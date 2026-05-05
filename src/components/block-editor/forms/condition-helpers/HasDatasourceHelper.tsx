/**
 * `HasDatasourceHelper` — argument input for `has-datasource:` and
 * `datasource-configured:` requirements.
 *
 * A plain text input plus a row of clickable suggestion badges, one per
 * **unique datasource type** the user has configured. We surface types
 * (not names) because the runtime check matches either, and types are
 * the more reliable authoring choice — users frequently rename their
 * datasources but the type stays stable. Built-in pseudo-datasources
 * (`-- Grafana --`, `-- Mixed --`, etc.) are filtered out since they're
 * never the right thing for a tutorial to gate on.
 *
 * We avoid the Grafana `Combobox` here because its `createCustomValue`
 * mode has surprising autocomplete behaviour that prepends partial
 * matches when the field is re-focused.
 */

import React, { useEffect, useMemo } from 'react';
import { Badge, Input, Stack, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { getDataSourceSrv } from '@grafana/runtime';
import type { ConditionHelperProps } from './types';

interface TypeSuggestion {
  type: string;
  /** Names of the user's datasources with this type — shown in tooltip. */
  instanceNames: string[];
}

function loadTypeSuggestions(): TypeSuggestion[] {
  try {
    const sources = getDataSourceSrv().getList();
    const byType = new Map<string, string[]>();
    for (const ds of sources) {
      // Skip Grafana's built-in pseudo-datasources (-- Grafana --, -- Mixed --,
      // etc.). These are never useful targets for a tutorial requirement.
      if (ds.meta?.builtIn) {
        continue;
      }
      const list = byType.get(ds.type) ?? [];
      list.push(ds.name);
      byType.set(ds.type, list);
    }
    return Array.from(byType.entries()).map(([type, instanceNames]) => ({
      type,
      instanceNames,
    }));
  } catch {
    return [];
  }
}

function tooltipFor(s: TypeSuggestion): string {
  if (s.instanceNames.length === 1) {
    return `Match the ${s.type} datasource (currently named "${s.instanceNames[0]}")`;
  }
  return `Match any of the ${s.instanceNames.length} ${s.type} datasources you have configured`;
}

export function HasDatasourceHelper({ value, onChange, onSubmit, onValidityChange, testId }: ConditionHelperProps) {
  const styles = useStyles2(getStyles);
  const suggestions = useMemo(() => loadTypeSuggestions(), []);

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
          <span className={styles.suggestionsLabel}>Click a datasource type to match any datasource of that type:</span>
          <div className={styles.suggestionsList}>
            {suggestions.map((s) => (
              <Badge
                key={s.type}
                text={s.type}
                color="blue"
                tooltip={tooltipFor(s)}
                className={styles.suggestionBadge}
                onClick={() => onChange(s.type)}
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
