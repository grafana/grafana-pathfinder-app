/**
 * `HasDatasourceHelper` — argument input for `has-datasource:` and
 * `datasource-configured:` requirements.
 *
 * The runtime check matches a typed argument case-insensitively against
 * either the datasource **name** or **type**, so authors have two valid
 * choices:
 *
 * - **Type** (e.g. `prometheus`) — matches any prometheus datasource
 *   regardless of what the user named it. The recommended choice for
 *   "this guide needs a Prometheus datasource".
 * - **Name** (e.g. `my-prod-prom`) — matches a specific configured
 *   datasource. Useful when a learning path expects a particular one
 *   to have been set up in an earlier step.
 *
 * We render both as separate groups of clickable badges with explicit
 * labels so the choice is obvious. Built-in pseudo-datasources
 * (`-- Grafana --`, the variables backer, etc.) are filtered out via
 * `meta.builtIn` since they're never useful tutorial targets.
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

interface NameSuggestion {
  name: string;
  type: string;
}

interface Suggestions {
  types: TypeSuggestion[];
  names: NameSuggestion[];
}

function loadSuggestions(): Suggestions {
  try {
    const sources = getDataSourceSrv().getList();
    const byType = new Map<string, string[]>();
    const names: NameSuggestion[] = [];
    for (const ds of sources) {
      // Skip Grafana's built-in pseudo-datasources (-- Grafana --, -- Mixed --,
      // the variables-backer, etc.). These are never useful targets for a
      // tutorial requirement.
      if (ds.meta?.builtIn) {
        continue;
      }
      const list = byType.get(ds.type) ?? [];
      list.push(ds.name);
      byType.set(ds.type, list);
      names.push({ name: ds.name, type: ds.type });
    }
    const types = Array.from(byType.entries()).map(([type, instanceNames]) => ({
      type,
      instanceNames,
    }));
    return { types, names };
  } catch {
    return { types: [], names: [] };
  }
}

function tooltipForType(s: TypeSuggestion): string {
  if (s.instanceNames.length === 1) {
    return `Match the ${s.type} datasource (currently named "${s.instanceNames[0]}")`;
  }
  return `Match any of the ${s.instanceNames.length} ${s.type} datasources you have configured`;
}

function tooltipForName(s: NameSuggestion): string {
  return `Match this exact datasource (type: ${s.type}). Will not match if the user renames it.`;
}

export function HasDatasourceHelper({ value, onChange, onSubmit, onValidityChange, testId }: ConditionHelperProps) {
  const styles = useStyles2(getStyles);
  const { types, names } = useMemo(() => loadSuggestions(), []);

  useEffect(() => {
    onValidityChange?.(value.trim().length > 0);
  }, [value, onValidityChange]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && value.trim().length > 0) {
      e.preventDefault();
      onSubmit();
    }
  };

  const hasAny = types.length > 0 || names.length > 0;

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
      {hasAny && (
        <div className={styles.groups}>
          {types.length > 0 && (
            <div className={styles.group}>
              <span className={styles.groupLabel}>By type (recommended — survives renames)</span>
              <div className={styles.badgesList}>
                {types.map((s) => (
                  <Badge
                    key={`type-${s.type}`}
                    text={s.type}
                    color="blue"
                    tooltip={tooltipForType(s)}
                    className={styles.suggestionBadge}
                    onClick={() => onChange(s.type)}
                  />
                ))}
              </div>
            </div>
          )}
          {names.length > 0 && (
            <div className={styles.group}>
              <span className={styles.groupLabel}>Or by name (matches one specific datasource)</span>
              <div className={styles.badgesList}>
                {names.map((s) => (
                  <Badge
                    key={`name-${s.name}`}
                    text={s.name}
                    color="darkgrey"
                    tooltip={tooltipForName(s)}
                    className={styles.suggestionBadge}
                    onClick={() => onChange(s.name)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Stack>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  groups: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  }),
  group: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
  }),
  groupLabel: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  badgesList: css({
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(0.5),
  }),
  suggestionBadge: css({
    cursor: 'pointer',
  }),
});
