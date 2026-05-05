/**
 * `OnPageHelper` — argument input for `on-page:` requirements.
 *
 * Provides an autocomplete combobox with a known-routes shortlist and a
 * "Use current page" button so authors don't have to type or remember
 * Grafana paths. Custom freeform input is still allowed (the underlying
 * combobox accepts arbitrary strings).
 *
 * Validity: the value must start with `/` (the canonical condition
 * validator enforces this; we mirror the rule here so the parent can
 * gate the "Add" button).
 */

import React, { useEffect, useMemo } from 'react';
import { Button, Combobox, Stack, type ComboboxOption } from '@grafana/ui';
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

const ROUTE_OPTIONS: Array<ComboboxOption<string>> = KNOWN_ROUTES.map((r) => ({
  value: r.value,
  label: r.value,
  description: r.description,
}));

function getCurrentPath(): string {
  try {
    return window.location.pathname || '/';
  } catch {
    return '/';
  }
}

export function OnPageHelper({ value, onChange, onSubmit, onValidityChange, testId }: ConditionHelperProps) {
  const currentPath = useMemo(() => getCurrentPath(), []);
  const isValid = value.startsWith('/');

  useEffect(() => {
    onValidityChange?.(isValid && value.length > 1);
  }, [isValid, value, onValidityChange]);

  const handleUseCurrent = () => {
    onChange(currentPath);
  };

  return (
    <Stack direction="column" gap={1}>
      <Combobox
        options={ROUTE_OPTIONS}
        value={value}
        onChange={(option) => onChange(option?.value ?? '')}
        createCustomValue
        placeholder="/explore, /dashboards, …"
        data-testid={testId}
      />
      <Stack direction="row" gap={1} alignItems="center">
        <Button size="sm" variant="secondary" fill="text" type="button" icon="map-marker" onClick={handleUseCurrent}>
          Use current page ({currentPath})
        </Button>
      </Stack>
      <input
        type="hidden"
        // Hidden submit hook so parent's Enter-to-add still works after path edits.
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
    </Stack>
  );
}
