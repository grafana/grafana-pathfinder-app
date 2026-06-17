import { createContext, useContext } from 'react';

export type InteractiveMode = 'interactive';

export const InteractiveModeContext = createContext<InteractiveMode>('interactive');

export function useInteractiveMode(): InteractiveMode {
  return useContext(InteractiveModeContext);
}
