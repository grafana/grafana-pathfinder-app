import { createContext, useContext } from 'react';
import type { CompletionCoordinator } from './coordinator';

export const CompletionObservationContext = createContext<CompletionCoordinator | null>(null);
export const useCompletionCoordinator = () => useContext(CompletionObservationContext);
