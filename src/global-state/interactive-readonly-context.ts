import { createContext, useContext } from 'react';

export type InteractiveMode = 'interactive' | 'readonly';

export const InteractiveModeContext = createContext<InteractiveMode>('interactive');

export function useIsInteractiveReadonly(): boolean {
  return useContext(InteractiveModeContext) === 'readonly';
}
