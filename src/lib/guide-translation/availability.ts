/**
 * The availability rule (docs/design/I18N.md §6.7): a guide is offered in a
 * locale when every translatable unit resolved to a reviewed translation, or
 * when the locale's sidecar carries the tooling-stamped `_available` latch.
 * A provisional pilot contract (§11), kept apart so that a change to it is an
 * edit to this one function.
 */

export interface UnitResolution {
  /** Every translatable field present on the canonical unit resolved to a reviewed translated value. */
  readonly complete: boolean;
}

export function isLocaleAvailable(units: readonly UnitResolution[], latched: boolean): boolean {
  return latched || units.every((unit) => unit.complete);
}
