import { useCallback, useState } from 'react';

import { ResolvedPathfinderConfig } from '../../constants';
import { usePathfinderPluginConfig } from '../../hooks';

export interface SeededDraft<S> {
  draft: S;
  changes: Partial<S>;
  edit: (changes: Partial<S>) => void;
  config: ResolvedPathfinderConfig;
  isResolved: boolean;
}

export function useSeededDraft<S extends object>(build: (config: ResolvedPathfinderConfig) => S): SeededDraft<S> {
  const { config, isResolved } = usePathfinderPluginConfig();
  const [changes, setChanges] = useState<Partial<S>>({});
  const edit = useCallback((patch: Partial<S>) => {
    setChanges((previous) => ({ ...previous, ...patch }));
  }, []);

  return { draft: { ...build(config), ...changes }, changes, edit, config, isResolved };
}
