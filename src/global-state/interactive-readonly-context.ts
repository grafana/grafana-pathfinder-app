import { createContext, useContext } from 'react';

export const InteractiveReadonlyContext = createContext<boolean>(false);

/**
 * True when interactive steps should render without their action controls
 * (the read-only external-tab viewer). Defaults to `false` outside a provider,
 * so the sidebar and floating surfaces stay fully interactive.
 */
export function useIsInteractiveReadonly(): boolean {
  return useContext(InteractiveReadonlyContext);
}
