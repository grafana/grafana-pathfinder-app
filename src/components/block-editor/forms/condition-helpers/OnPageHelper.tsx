/**
 * `OnPageHelper` — argument input for `on-page:` requirements.
 *
 * A plain text input plus a "Use current page" shortcut and a row of
 * clickable badges for the most-used Grafana paths. Validity: the value
 * must start with `/` (the canonical condition validator enforces this;
 * we mirror the rule here so the parent can gate the "Add" button).
 *
 * Avoids the Grafana `Combobox` because its `createCustomValue` mode
 * has surprising autocomplete behaviour that prepends partial matches
 * when the field is re-focused.
 */

import React, { useEffect, useMemo } from 'react';
import { Badge, Button, Input, Stack, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import type { ConditionHelperProps } from './types';

const KNOWN_ROUTES: ReadonlyArray<{ value: string; description: string }> = [
  { value: '/explore', description: 'Explore (ad-hoc query)' },
  { value: '/dashboards', description: 'Dashboards list' },
  { value: '/connections', description: 'Connections (data sources, integrations)' },
  { value: '/alerting', description: 'Alerting' },
  { value: '/admin', description: 'Server / org administration' },
  { value: '/plugins', description: 'Plugins catalog' },
  { value: '/playlists', description: 'Playlists' },
  { value: '/library-panels', description: 'Library panels' },
  { value: '/datasources', description: 'Data sources (legacy path)' },
  { value: '/profile', description: 'User profile' },
];

function getCurrentPath(): string {
  try {
    return window.location.pathname || '/';
  } catch {
    return '/';
  }
}

export function OnPageHelper({ value, onChange, onSubmit, onValidityChange, testId }: ConditionHelperProps) {
  const styles = useStyles2(getStyles);
  const currentPath = useMemo(() => getCurrentPath(), []);
  const isValid = value.startsWith('/') && value.length > 1;

  useEffect(() => {
    onValidityChange?.(isValid);
  }, [isValid, onValidityChange]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && isValid) {
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
        placeholder="e.g., /explore"
        autoFocus
        data-testid={testId}
      />
      <Stack direction="row" gap={1} alignItems="center">
        <Button
          size="sm"
          variant="secondary"
          fill="text"
          type="button"
          icon="map-marker"
          onClick={() => onChange(currentPath)}
        >
          Use current page ({currentPath})
        </Button>
      </Stack>
      <div className={styles.suggestionsContainer}>
        <span className={styles.suggestionsLabel}>Or pick a common page:</span>
        <div className={styles.suggestionsList}>
          {KNOWN_ROUTES.map((r) => (
            <Badge
              key={r.value}
              text={r.value}
              color="blue"
              tooltip={r.description}
              className={styles.suggestionBadge}
              onClick={() => onChange(r.value)}
            />
          ))}
        </div>
      </div>
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
