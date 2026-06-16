import { getEchoSrv, EchoEventType } from '@grafana/runtime';

/**
 * Context event bus.
 *
 * Owns the EchoSrv subscription that watches Grafana's user-interaction stream
 * for "what's the user currently working with?" signals (datasource selection,
 * panel/visualization picker, query execution) and exposes them to the rest of
 * the context engine. Also owns the change-listener set that hooks subscribe
 * to so they re-render when the inferred datasource or visualization changes.
 *
 * The bus is a module-singleton: state is intentionally module-scoped so the
 * EchoSrv backend can be registered exactly once per page load and so any
 * caller — UI hook, requirements checker, assistant tool — observes the same
 * inferred values without coordinating through React state.
 *
 * Previously lived as private static fields/methods on `ContextService`; split
 * out so the god class no longer co-owns I/O state with recommendation
 * orchestration. See PR description for the broader split plan.
 */

interface BufferedEvent {
  datasourceType?: string;
  visualizationType?: string;
  timestamp: number;
  source: string;
}

const BUFFER_SIZE = 10;
const BUFFER_TTL = 300000; // 5 minutes

let echoLoggingInitialized = false;
let currentDatasourceType: string | null = null;
let currentVisualizationType: string | null = null;
let eventBuffer: BufferedEvent[] = [];
const changeListeners: Set<() => void> = new Set();

/**
 * Datasource type detected from EchoSrv events (Phase 2 & 3: Echo-based detection).
 *
 * Supported event sources:
 * - grafana_ds_add_datasource_clicked: New datasource configuration
 * - grafana_ds_test_datasource_clicked: Existing datasource configuration (workaround)
 * - dashboards_dspicker_clicked: Dashboard datasource selection for querying
 * - data-request (meta-analytics): Active query execution in explore/dashboard
 */
export function getDetectedDatasourceType(): string | null {
  return currentDatasourceType;
}

/**
 * Visualization type detected from EchoSrv events (Phase 4: Echo-based detection).
 *
 * Supported event sources:
 * - dashboards_panel_plugin_picker_clicked: Panel/visualization type selection in dashboards
 */
export function getDetectedVisualizationType(): string | null {
  return currentVisualizationType;
}

/**
 * Subscribe to context changes (for hooks to refresh when EchoSrv events occur).
 * Returns an unsubscribe function.
 */
export function onContextChange(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

function notifyContextChange(): void {
  changeListeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.error('Error in context change listener:', error);
    }
  });
}

function addToEventBuffer(event: BufferedEvent): void {
  const now = Date.now();
  eventBuffer = eventBuffer.filter((e) => now - e.timestamp < BUFFER_TTL);
  eventBuffer.push(event);
  if (eventBuffer.length > BUFFER_SIZE) {
    eventBuffer = eventBuffer.slice(-BUFFER_SIZE);
  }
  notifyContextChange();
}

/**
 * Initialize context from recent events (called when plugin reopens).
 * Replays the most recent buffered datasource and visualization events so a
 * fresh hook mount reflects what the user was doing before the panel closed.
 */
export function initializeFromRecentEvents(): void {
  const now = Date.now();

  const recentDatasourceEvent = eventBuffer
    .filter((e) => e.datasourceType && now - e.timestamp < BUFFER_TTL)
    .sort((a, b) => b.timestamp - a.timestamp)[0];

  const recentVizEvent = eventBuffer
    .filter((e) => e.visualizationType && now - e.timestamp < BUFFER_TTL)
    .sort((a, b) => b.timestamp - a.timestamp)[0];

  if (recentDatasourceEvent) {
    currentDatasourceType = recentDatasourceEvent.datasourceType!;
  }

  if (recentVizEvent) {
    currentVisualizationType = recentVizEvent.visualizationType!;
  }
}

/**
 * Initialize EchoSrv event logging. Idempotent — safe to call from both the
 * plugin lifecycle hook and the lazy fallback in `ContextService.getContextData`.
 */
export function initializeEchoLogging(): void {
  if (echoLoggingInitialized) {
    return;
  }

  try {
    const echoSrv = getEchoSrv();

    echoSrv.addBackend({
      supportedEvents: [EchoEventType.Interaction, EchoEventType.Pageview, EchoEventType.MetaAnalytics],
      options: { name: 'context-service-logger' },
      flush: () => {
        // No-op for logging backend
      },
      addEvent: (event) => {
        if (event.type === 'interaction') {
          // Primary: New datasource selection
          if (event.payload?.interactionName === 'grafana_ds_add_datasource_clicked') {
            const pluginId = event.payload?.properties?.plugin_id;
            if (pluginId) {
              currentDatasourceType = pluginId;
              addToEventBuffer({ datasourceType: pluginId, timestamp: Date.now(), source: 'add' });
            }
          }

          // Workaround: Existing datasource edit detection via "Save & Test".
          // TODO: Find a better event for datasource edit page loads instead of relying on Save & Test.
          // This approach only works after user clicks Save & Test, not on initial page load.
          if (event.payload?.interactionName === 'grafana_ds_test_datasource_clicked') {
            const pluginId = event.payload?.properties?.plugin_id;
            if (pluginId) {
              currentDatasourceType = pluginId;
              addToEventBuffer({ datasourceType: pluginId, timestamp: Date.now(), source: 'test' });
            }
          }

          if (event.payload?.interactionName === 'dashboards_dspicker_clicked') {
            const dsType = event.payload?.properties?.ds_type;
            if (dsType) {
              currentDatasourceType = dsType;
              addToEventBuffer({ datasourceType: dsType, timestamp: Date.now(), source: 'dashboard-picker' });
            }
          }

          if (event.payload?.interactionName === 'dashboards_panel_plugin_picker_clicked') {
            const pluginId = event.payload?.properties?.plugin_id;
            if (pluginId && event.payload?.properties?.item === 'select_panel_plugin') {
              currentVisualizationType = pluginId;
              addToEventBuffer({ visualizationType: pluginId, timestamp: Date.now(), source: 'panel-picker' });
            }
          }
        }

        // Explore query execution - detect active datasource usage
        if (event.type === 'meta-analytics' && event.payload?.eventName === 'data-request') {
          const datasourceType = event.payload?.datasourceType;
          const source = event.payload?.source;
          if (datasourceType && source) {
            currentDatasourceType = datasourceType;
            addToEventBuffer({ datasourceType, timestamp: Date.now(), source: `${source}-query` });
          }
        }
      },
    });

    echoLoggingInitialized = true;
  } catch (error) {
    console.error('Failed to initialize EchoSrv logging:', error);
  }
}

/**
 * Test-only reset. Clears all mutable state and the registered EchoSrv backend
 * tracking flag. Production callers must not use this — the EchoSrv backend
 * itself is registered exactly once and cannot be unregistered.
 */
export function __resetContextEventBusForTests(): void {
  echoLoggingInitialized = false;
  currentDatasourceType = null;
  currentVisualizationType = null;
  eventBuffer = [];
  changeListeners.clear();
}

/**
 * Test-only trigger that fires the notify-listeners path without having to
 * stage a buffered event. Used by integration tests in `requirements-manager`
 * that just want to assert listener wiring.
 */
export function __notifyContextChangeForTests(): void {
  notifyContextChange();
}

/**
 * Test-only clear of the inferred `current*` values while leaving the buffer
 * and listener set intact. Exists so tests can stage buffered events, wipe
 * the "live" cache, and then assert that `initializeFromRecentEvents` replays
 * the most-recent entry — the only path through which that function does any
 * observable work.
 */
export function __clearCurrentValuesForTests(): void {
  currentDatasourceType = null;
  currentVisualizationType = null;
}
