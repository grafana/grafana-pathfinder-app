/**
 * Coda catalogue lists (sample apps, Alloy scenarios) as Combobox options, for
 * block-editor forms that let an author pick an item with autocomplete and a
 * custom-value fallback.
 *
 * Read from `/v1/capabilities`, which already carries both catalogues, rather
 * than from per-catalogue routes: the SDK does not model those, so hand-built
 * URLs and guessed response keys could drift out of the v1 contract silently —
 * a rename would empty the dropdown and look exactly like "plugin absent".
 * The shared cached read also means an author toggling between template types
 * pays one request per page load, and a plugin-absent editor gets no global
 * error toast.
 */

import { useEffect, useMemo, useState } from 'react';
import { type ComboboxOption } from '@grafana/ui';
import { loadCodaCapabilities, useCodaTerminalGate } from '../../../integrations/coda/useCodaAvailability.hook';
import type { CatalogueItem } from '../../../integrations/coda/coda-api';

/** Keys of `CodaCapabilities` that hold an author-selectable catalogue. */
export type CodaCatalogue = 'templates' | 'sampleApps' | 'alloyScenarios';

/**
 * `status` is the upstream service's own vocabulary, forwarded verbatim and not
 * a closed set, so anything other than `validated` is surfaced as-is rather
 * than mapped — an author choosing between two similar entries needs to see
 * that one is experimental.
 */
function toOption(item: CatalogueItem): ComboboxOption<string> {
  const description =
    item.status && item.status !== 'validated' ? `${item.description} (${item.status})` : item.description;
  return { label: item.name, value: item.id, description };
}

export function useCodaOptions(
  wanted: boolean,
  catalogue: CodaCatalogue
): { options: Array<ComboboxOption<string>>; isLoading: boolean; unavailable: boolean } {
  // A form open on a stack with the terminal switched off reads no catalogue —
  // the gate belongs here rather than at five call sites.
  const gate = useCodaTerminalGate();
  const enabled = wanted && gate !== 'disabled';
  const [options, setOptions] = useState<Array<ComboboxOption<string>>>([]);
  const [unavailable, setUnavailable] = useState(false);
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
    let cancelled = false;

    loadCodaCapabilities().then((capabilities) => {
      if (cancelled) {
        return;
      }
      setUnavailable(capabilities === null);
      setOptions(capabilities ? capabilities[catalogue].map(toOption) : []);
      setDone(true);
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, catalogue]);

  return { options, isLoading: enabled && !done, unavailable };
}

const DEFAULT_TEMPLATE_OPTION: ComboboxOption<string> = { label: 'Default', value: '' };

/**
 * The templates this build knew about before `capabilities.templates` existed.
 * Kept only for a backend too old to advertise the list, or one that cannot be
 * reached at all — an editor still has to offer something.
 */
const LEGACY_TEMPLATE_OPTIONS: Array<ComboboxOption<string>> = [
  { label: 'Default (vm-aws)', value: '' },
  { label: 'Sample app (vm-aws-sample-app)', value: 'vm-aws-sample-app' },
  { label: 'Alloy scenario (vm-aws-alloy-scenario)', value: 'vm-aws-alloy-scenario' },
];

/**
 * VM templates the provider currently offers, `''` meaning "let the backend
 * choose".
 *
 * `capabilities.templates` is the authority: a hardcoded list cannot show a
 * template the provider added, and goes on offering ones it removed. `current`
 * is always present in the result, so a template already saved in a guide never
 * silently disappears from the form because this provider stopped listing it —
 * an author editing an unrelated field would otherwise save the block with the
 * VM changed under them.
 */
export function useCodaTemplateOptions(current: string): {
  options: Array<ComboboxOption<string>>;
  isLoading: boolean;
} {
  const { options, isLoading, unavailable } = useCodaOptions(true, 'templates');

  const resolved = useMemo(() => {
    const base = unavailable || options.length === 0 ? LEGACY_TEMPLATE_OPTIONS : [DEFAULT_TEMPLATE_OPTION, ...options];
    if (current && !base.some((option) => option.value === current)) {
      return [...base, { label: current, value: current, description: 'not offered by this backend' }];
    }
    return base;
  }, [options, unavailable, current]);

  return { options: resolved, isLoading };
}
