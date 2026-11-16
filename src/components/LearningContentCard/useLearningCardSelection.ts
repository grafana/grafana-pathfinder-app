import { useCallback, useEffect, useState } from 'react';

import { onPathfinderSurfaceChange } from '../../lib/telemetry/surface';

export function useLearningCardSelection(scope: string) {
  const [selection, setSelection] = useState<{ scope: string; key: string } | null>(null);
  useEffect(
    () =>
      onPathfinderSurfaceChange((surface) => {
        if (surface === 'closed') {
          setSelection(null);
        }
      }),
    []
  );
  const selectCard = useCallback((key: string) => setSelection({ scope, key }), [scope]);
  return { selectedCardKey: selection?.scope === scope ? selection.key : null, selectCard };
}
