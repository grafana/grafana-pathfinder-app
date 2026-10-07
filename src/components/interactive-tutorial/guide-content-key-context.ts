import { createContext } from 'react';

/** Progress key of the guide whose renderer owns the sections beneath it; undefined outside a renderer. */
export const GuideContentKeyContext = createContext<string | undefined>(undefined);
