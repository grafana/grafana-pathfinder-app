/** Inline picker for choosing a snippet from the CDN catalog. */

import React, { useEffect, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { Field, Input, Spinner, useStyles2, Icon } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';

import { getSnippetResolver } from '../../snippet-engine';
import type { SnippetCatalogEntry } from '../../types/json-snippet.types';

interface SnippetPickerProps {
  value?: string;
  onSelect: (snippetId: string) => void;
}

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  }),
  list: css({
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    maxHeight: '300px',
    overflowY: 'auto',
  }),
  empty: css({
    padding: theme.spacing(2),
    color: theme.colors.text.secondary,
    textAlign: 'center',
  }),
  loading: css({
    padding: theme.spacing(2),
    display: 'flex',
    justifyContent: 'center',
  }),
  row: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.25),
    padding: theme.spacing(1.5),
    cursor: 'pointer',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    '&:last-child': { borderBottom: 'none' },
    '&:hover': { backgroundColor: theme.colors.action.hover },
  }),
  rowSelected: css({
    backgroundColor: theme.colors.action.selected,
  }),
  rowHeader: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    fontWeight: theme.typography.fontWeightMedium,
  }),
  rowMeta: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
});

export function SnippetPicker({ value, onSelect }: SnippetPickerProps) {
  const styles = useStyles2(getStyles);
  const [entries, setEntries] = useState<SnippetCatalogEntry[] | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const catalog = await getSnippetResolver().list();
      if (cancelled) {
        return;
      }
      setEntries(Object.values(catalog));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!entries) {
      return [];
    }
    const q = query.trim().toLowerCase();
    if (!q) {
      return entries;
    }
    return entries.filter((e) => {
      const haystack = [e.id, e.title, e.description, e.category, ...(e.tags ?? [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [entries, query]);

  return (
    <div className={styles.container}>
      <Field label="Search snippets">
        <Input
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="Title, description, tag, category…"
          prefix={<Icon name="search" />}
        />
      </Field>
      <div className={styles.list}>
        {entries === null && (
          <div className={styles.loading}>
            <Spinner />
          </div>
        )}
        {entries !== null && filtered.length === 0 && (
          <div className={styles.empty}>No snippets match your search.</div>
        )}
        {entries !== null &&
          filtered.map((entry) => {
            const isSelected = entry.id === value;
            return (
              <div
                key={entry.id}
                className={`${styles.row} ${isSelected ? styles.rowSelected : ''}`}
                onClick={() => onSelect(entry.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(entry.id);
                  }
                }}
              >
                <div className={styles.rowHeader}>
                  <Icon name="share-alt" />
                  <span>{entry.title}</span>
                </div>
                {entry.description && <div className={styles.rowMeta}>{entry.description}</div>}
                <div className={styles.rowMeta}>
                  <code>{entry.id}</code>
                  {entry.category ? ` · ${entry.category}` : ''}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}

SnippetPicker.displayName = 'SnippetPicker';
