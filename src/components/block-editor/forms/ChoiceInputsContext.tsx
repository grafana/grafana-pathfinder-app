import React, { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { JsonBlock, JsonInputBlock } from '../../../types/json-guide.types';

const ChoiceInputsContext = createContext<JsonInputBlock[]>([]);

function collectChoiceInputs(blocks: readonly JsonBlock[]): JsonInputBlock[] {
  return blocks.flatMap((block) => {
    if (block.type === 'input' && block.inputType === 'checkbox-group') {
      return [block];
    }
    if ('blocks' in block) {
      return collectChoiceInputs(block.blocks);
    }
    if (block.type === 'conditional') {
      return [...collectChoiceInputs(block.whenTrue), ...collectChoiceInputs(block.whenFalse ?? [])];
    }
    return [];
  });
}

export function ChoiceInputsProvider({ blocks, children }: { blocks: readonly JsonBlock[]; children: ReactNode }) {
  const inputs = useMemo(() => collectChoiceInputs(blocks), [blocks]);
  return <ChoiceInputsContext.Provider value={inputs}>{children}</ChoiceInputsContext.Provider>;
}

export function useChoiceInputs(): JsonInputBlock[] {
  return useContext(ChoiceInputsContext);
}
