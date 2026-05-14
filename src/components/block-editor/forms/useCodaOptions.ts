/**
 * Shared hook for fetching Coda catalog lists (sample apps, alloy scenarios,
 * any future /api/v1/<list> endpoint that follows the same shape).
 *
 * Used by block-editor forms that let the author pick an item from a remote
 * catalog with autocomplete + custom-value fallback (e.g. ChallengeBlockForm
 * and TerminalConnectBlockForm).
 */

import { useEffect, useState } from 'react';
import { getBackendSrv } from '@grafana/runtime';
import { type ComboboxOption } from '@grafana/ui';

interface CodaListItem {
  id: string;
  name: string;
  description: string;
  status: string;
}

/**
 * Fetch a Coda list endpoint and surface it as Combobox options.
 *
 * @param enabled  Whether the fetch should be active. The hook short-circuits
 *                 when this is false so we don't make spurious requests for
 *                 fields that aren't currently rendered.
 * @param url      Backend URL to fetch from.
 * @param key      Response key that holds the array (e.g. "apps", "scenarios").
 */
export function useCodaOptions(
  enabled: boolean,
  url: string,
  key: string
): { options: Array<ComboboxOption<string>>; isLoading: boolean } {
  const [options, setOptions] = useState<Array<ComboboxOption<string>>>([]);
  const [done, setDone] = useState(false);
  const [prevEnabled, setPrevEnabled] = useState(enabled);

  if (enabled !== prevEnabled) {
    setPrevEnabled(enabled);
    if (enabled) {
      setDone(false);
    }
  }

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const sub = getBackendSrv()
      .fetch<Record<string, CodaListItem[]>>({ url })
      .subscribe({
        next(resp) {
          const items = resp?.data?.[key];
          if (items) {
            setOptions(
              items.map((item) => ({
                label: item.name,
                value: item.id,
                description: item.description,
              }))
            );
          }
          setDone(true);
        },
        error() {
          setDone(true);
        },
      });

    return () => sub.unsubscribe();
  }, [enabled, url, key]);

  return { options, isLoading: enabled && !done };
}
