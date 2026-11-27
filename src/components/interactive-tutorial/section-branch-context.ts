import React, { createContext } from 'react';

export interface SectionBranchContextValue {
  register: (id: string, children: readonly React.ReactNode[] | undefined) => void;
  enhance: (child: React.ReactNode) => React.ReactNode;
}

export const SectionBranchContext = createContext<SectionBranchContextValue | null>(null);

export const ConditionalExecutionContext = createContext<((token: object, executing: boolean) => void) | null>(null);
