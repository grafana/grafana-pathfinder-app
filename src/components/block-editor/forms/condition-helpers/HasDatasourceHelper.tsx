/**
 * `HasDatasourceHelper` — argument input for `has-datasource:` and
 * `datasource-configured:` requirements.
 *
 * Pulls the live datasource list from `getDataSourceSrv().getList()` so
 * the author can pick a real datasource by name or type instead of
 * typing it. Falls back to a free-form combobox when the runtime isn't
 * available (e.g. in tests).
 */

import React, { useEffect, useMemo } from 'react';
import { Combobox, type ComboboxOption } from '@grafana/ui';
import { getDataSourceSrv } from '@grafana/runtime';
import type { ConditionHelperProps } from './types';

function loadDatasourceOptions(): Array<ComboboxOption<string>> {
  try {
    const sources = getDataSourceSrv().getList();
    // Offer name and type as separate options so authors can target either.
    const byName = sources.map((ds) => ({
      value: ds.name,
      label: ds.name,
      description: `Type: ${ds.type}`,
    }));
    const types = Array.from(new Set(sources.map((ds) => ds.type))).map((type) => ({
      value: type,
      label: type,
      description: 'Match any datasource of this type',
    }));
    return [...byName, ...types];
  } catch {
    return [];
  }
}

export function HasDatasourceHelper({ value, onChange, onValidityChange, testId }: ConditionHelperProps) {
  const options = useMemo(() => loadDatasourceOptions(), []);

  useEffect(() => {
    onValidityChange?.(value.trim().length > 0);
  }, [value, onValidityChange]);

  return (
    <Combobox
      options={options}
      value={value}
      onChange={(option) => onChange(option?.value ?? '')}
      createCustomValue
      placeholder="prometheus, loki, …"
      data-testid={testId}
    />
  );
}
