/**
 * Form draft state for a configuration tab, seeded from the resolved config.
 *
 * WHY NOT `plugin.meta.jsonData`
 *
 * Every tab used to seed from the plugin-settings snapshot Grafana handed the
 * config page. Once tenant settings moved to the `PathfinderSettings` resource,
 * a save on Cloud stopped touching `jsonData` at all — so a tab seeded from it
 * re-rendered the pre-migration values after the reload, and the next save from
 * that tab sent those stale values back as the fields it owns. Reading through
 * the same resolve layer the rest of the app renders from is what closes that:
 * the store the tab writes to is the store it reads from.
 *
 * `saveTenantSettings` already stops one tab overwriting another's fields. This
 * stops a tab overwriting its own.
 *
 * The build function must be stable across renders — define it at module scope,
 * not inline — because a re-seed is triggered by identity change.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { ResolvedPathfinderConfig } from '../../constants';
import { usePathfinderPluginConfig } from '../../hooks';

export interface SeededDraft<S> {
  draft: S;
  edit: (changes: Partial<S>) => void;
  /** The resolved config the draft was seeded from, for fields the form only reads. */
  config: ResolvedPathfinderConfig;
  /** False until the authoritative read lands; distinct from an all-defaults config. */
  isResolved: boolean;
}

export function useSeededDraft<S extends object>(build: (config: ResolvedPathfinderConfig) => S): SeededDraft<S> {
  const { config, isResolved } = usePathfinderPluginConfig();
  const isEdited = useRef(false);
  const [draft, setDraft] = useState<S>(() => build(config));

  // Re-seed when the authoritative read lands, but never over an edit the admin
  // has already made — losing someone's typing to a background read is worse
  // than showing them a value one read behind.
  useEffect(() => {
    if (!isEdited.current) {
      setDraft(build(config));
    }
  }, [config, build]);

  const edit = useCallback((changes: Partial<S>) => {
    isEdited.current = true;
    setDraft((previous) => ({ ...previous, ...changes }));
  }, []);

  return { draft, edit, config, isResolved };
}
