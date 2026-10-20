import { contextLocationKey } from './context-location';
import { getEchoSrv, EchoEventType, locationService } from '@grafana/runtime';
import { logger } from './logging';

// Module-scoped state keeps one EchoSrv subscription and shared inferred values across all consumers.

interface BufferedEvent {
  datasourceType?: string;
  visualizationType?: string;
  timestamp: number;
  source: string;
  path?: string;
}

const BUFFER_SIZE = 10;
const BUFFER_TTL = 300000; // 5 minutes

let echoLoggingInitialized = false;
let currentDatasource: BufferedEvent | null = null;
let currentVisualization: BufferedEvent | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;

function currentPath(): string {
  const location = locationService?.getLocation() ?? window.location;
  return contextLocationKey(location.pathname, location.search);
}

function isCurrent(event: BufferedEvent): boolean {
  return event.path === currentPath() && Date.now() - event.timestamp < BUFFER_TTL;
}

function expireObservations(): void {
  eventBuffer = eventBuffer.filter(isCurrent);
  if (currentDatasource && !isCurrent(currentDatasource)) {
    currentDatasource = null;
  }
  if (currentVisualization && !isCurrent(currentVisualization)) {
    currentVisualization = null;
  }
}

function scheduleExpiry(): void {
  clearTimeout(expiryTimer);
  const observations = [currentDatasource, currentVisualization].filter(
    (event): event is BufferedEvent => event !== null
  );
  if (!changeListeners.size || !observations.length) {
    return;
  }
  const expiresAt = Math.min(...observations.map((event) => event.timestamp + BUFFER_TTL));
  expiryTimer = setTimeout(
    () => {
      expireObservations();
      notifyContextChange();
      scheduleExpiry();
    },
    Math.max(0, expiresAt - Date.now())
  );
}
let eventBuffer: BufferedEvent[] = [];
const changeListeners: Set<() => void> = new Set();

export function getDetectedDatasourceType(): string | null {
  expireObservations();
  return currentDatasource?.datasourceType ?? null;
}

export function getDetectedVisualizationType(): string | null {
  expireObservations();
  return currentVisualization?.visualizationType ?? null;
}

export function onContextChange(listener: () => void): () => void {
  changeListeners.add(listener);
  scheduleExpiry();
  return () => {
    changeListeners.delete(listener);
    scheduleExpiry();
  };
}

function notifyContextChange(): void {
  changeListeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      logger.error('Error in context change listener', { error });
    }
  });
}

function addToEventBuffer(event: BufferedEvent): void {
  expireObservations();
  event = { ...event, path: currentPath() };
  const previousDatasource = currentDatasource?.datasourceType;
  const previousVisualization = currentVisualization?.visualizationType;
  if (event.datasourceType) {
    currentDatasource = event;
  }
  if (event.visualizationType) {
    currentVisualization = event;
  }
  eventBuffer = eventBuffer.filter((e) => isCurrent(e));
  eventBuffer.push(event);
  if (eventBuffer.length > BUFFER_SIZE) {
    eventBuffer = eventBuffer.slice(-BUFFER_SIZE);
  }
  scheduleExpiry();
  if (
    previousDatasource !== currentDatasource?.datasourceType ||
    previousVisualization !== currentVisualization?.visualizationType
  ) {
    notifyContextChange();
  }
}

export function initializeFromRecentEvents(): void {
  expireObservations();
  const recentDatasourceEvent = eventBuffer
    .filter((e) => e.datasourceType && isCurrent(e))
    .sort((a, b) => b.timestamp - a.timestamp)[0];

  const recentVizEvent = eventBuffer
    .filter((e) => e.visualizationType && isCurrent(e))
    .sort((a, b) => b.timestamp - a.timestamp)[0];

  if (recentDatasourceEvent) {
    currentDatasource = recentDatasourceEvent;
  }

  if (recentVizEvent) {
    currentVisualization = recentVizEvent;
  }
  scheduleExpiry();
}

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
              addToEventBuffer({ datasourceType: pluginId, timestamp: Date.now(), source: 'add' });
            }
          }

          // Workaround: Existing datasource edit detection via "Save & Test".
          // TODO: Find a better event for datasource edit page loads instead of relying on Save & Test.
          // This approach only works after user clicks Save & Test, not on initial page load.
          if (event.payload?.interactionName === 'grafana_ds_test_datasource_clicked') {
            const pluginId = event.payload?.properties?.plugin_id;
            if (pluginId) {
              addToEventBuffer({ datasourceType: pluginId, timestamp: Date.now(), source: 'test' });
            }
          }

          if (event.payload?.interactionName === 'dashboards_dspicker_clicked') {
            const dsType = event.payload?.properties?.ds_type;
            if (dsType) {
              addToEventBuffer({ datasourceType: dsType, timestamp: Date.now(), source: 'dashboard-picker' });
            }
          }

          if (event.payload?.interactionName === 'dashboards_panel_plugin_picker_clicked') {
            const pluginId = event.payload?.properties?.plugin_id;
            if (pluginId && event.payload?.properties?.item === 'select_panel_plugin') {
              addToEventBuffer({ visualizationType: pluginId, timestamp: Date.now(), source: 'panel-picker' });
            }
          }
        }

        // Explore query execution - detect active datasource usage
        if (event.type === 'meta-analytics' && event.payload?.eventName === 'data-request') {
          const datasourceType = event.payload?.datasourceType;
          const source = event.payload?.source;
          if (datasourceType && source) {
            addToEventBuffer({ datasourceType, timestamp: Date.now(), source: `${source}-query` });
          }
        }
      },
    });

    echoLoggingInitialized = true;
  } catch (error) {
    logger.error('Failed to initialize EchoSrv logging', { error });
  }
}

export function __resetContextEventBusForTests(): void {
  echoLoggingInitialized = false;
  currentDatasource = null;
  currentVisualization = null;
  clearTimeout(expiryTimer);
  eventBuffer = [];
  changeListeners.clear();
}

export function __notifyContextChangeForTests(): void {
  notifyContextChange();
}

export function __clearCurrentValuesForTests(): void {
  currentDatasource = null;
  currentVisualization = null;
  clearTimeout(expiryTimer);
}
