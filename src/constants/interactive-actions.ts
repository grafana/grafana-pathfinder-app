/**
 * Interactive action values that drive the live Grafana UI — `highlight`,
 * `button`, `formfill`, `navigate`, `hover`. Shared between the launch-surface
 * classifier (`components/docs-panel/utils/requires-grafana-ui.ts`, which
 * decides whole-guide surface eligibility) and the interactive engine
 * (`interactive-engine/interactive.hook.ts`, which gates the click-triggered
 * full-screen → sidebar handoff) so the two can't drift into disagreeing on
 * which actions count.
 */
export const GRAFANA_DRIVING_ACTIONS: ReadonlySet<string> = new Set([
  'highlight',
  'button',
  'formfill',
  'navigate',
  'hover',
]);
