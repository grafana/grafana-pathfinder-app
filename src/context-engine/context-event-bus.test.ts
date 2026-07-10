/**
 * Tests for the context event bus.
 *
 * Covers: listener subscribe/unsubscribe, EchoSrv backend registration is
 * idempotent, the four interaction shapes are routed to the right inferred
 * value, the meta-analytics data-request shape updates the datasource, the
 * buffer caps at BUFFER_SIZE, and initializeFromRecentEvents picks the most
 * recent buffered event per dimension.
 */

type EchoEvent = {
  type: 'interaction' | 'meta-analytics' | 'pageview';
  payload?: any;
};

type Backend = {
  supportedEvents: string[];
  addEvent: (event: EchoEvent) => void;
};

let registeredBackends: Backend[] = [];

jest.mock('@grafana/runtime', () => ({
  getEchoSrv: jest.fn(() => ({
    addBackend: (backend: Backend) => {
      registeredBackends.push(backend);
    },
  })),
  EchoEventType: {
    Interaction: 'interaction',
    Pageview: 'pageview',
    MetaAnalytics: 'meta-analytics',
  },
}));

import {
  getDetectedDatasourceType,
  getDetectedVisualizationType,
  initializeEchoLogging,
  initializeFromRecentEvents,
  onContextChange,
  __clearCurrentValuesForTests,
  __notifyContextChangeForTests,
  __resetContextEventBusForTests,
} from './context-event-bus';

function dispatch(event: EchoEvent): void {
  // The bus registers exactly one backend; route through it.
  expect(registeredBackends).toHaveLength(1);
  const backend = registeredBackends[0];
  if (!backend) {
    throw new Error('expected EchoSrv backend to be registered');
  }
  backend.addEvent(event);
}

beforeEach(() => {
  registeredBackends = [];
  __resetContextEventBusForTests();
});

describe('initializeEchoLogging', () => {
  it('registers exactly one EchoSrv backend regardless of call count', () => {
    initializeEchoLogging();
    initializeEchoLogging();
    initializeEchoLogging();

    expect(registeredBackends).toHaveLength(1);
  });

  it('swallows EchoSrv failures so init never throws', () => {
    const runtime = require('@grafana/runtime');
    runtime.getEchoSrv.mockImplementationOnce(() => {
      throw new Error('echo unavailable');
    });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => initializeEchoLogging()).not.toThrow();
    expect(consoleSpy).toHaveBeenCalledWith('Failed to initialize EchoSrv logging', expect.any(Error), '');

    consoleSpy.mockRestore();
  });
});

describe('interaction event routing', () => {
  beforeEach(() => initializeEchoLogging());

  it('updates datasource from grafana_ds_add_datasource_clicked', () => {
    dispatch({
      type: 'interaction',
      payload: {
        interactionName: 'grafana_ds_add_datasource_clicked',
        properties: { plugin_id: 'prometheus' },
      },
    });
    expect(getDetectedDatasourceType()).toBe('prometheus');
  });

  it('updates datasource from grafana_ds_test_datasource_clicked', () => {
    dispatch({
      type: 'interaction',
      payload: {
        interactionName: 'grafana_ds_test_datasource_clicked',
        properties: { plugin_id: 'loki' },
      },
    });
    expect(getDetectedDatasourceType()).toBe('loki');
  });

  it('updates datasource from dashboards_dspicker_clicked', () => {
    dispatch({
      type: 'interaction',
      payload: {
        interactionName: 'dashboards_dspicker_clicked',
        properties: { ds_type: 'tempo' },
      },
    });
    expect(getDetectedDatasourceType()).toBe('tempo');
  });

  it('updates visualization only on select_panel_plugin item', () => {
    dispatch({
      type: 'interaction',
      payload: {
        interactionName: 'dashboards_panel_plugin_picker_clicked',
        properties: { plugin_id: 'timeseries', item: 'open_picker' },
      },
    });
    expect(getDetectedVisualizationType()).toBeNull();

    dispatch({
      type: 'interaction',
      payload: {
        interactionName: 'dashboards_panel_plugin_picker_clicked',
        properties: { plugin_id: 'bargauge', item: 'select_panel_plugin' },
      },
    });
    expect(getDetectedVisualizationType()).toBe('bargauge');
  });

  it('updates datasource from meta-analytics data-request', () => {
    dispatch({
      type: 'meta-analytics',
      payload: { eventName: 'data-request', datasourceType: 'mimir', source: 'explore' },
    });
    expect(getDetectedDatasourceType()).toBe('mimir');
  });

  it('ignores meta-analytics data-request when source is missing', () => {
    dispatch({
      type: 'meta-analytics',
      payload: { eventName: 'data-request', datasourceType: 'mimir' },
    });
    expect(getDetectedDatasourceType()).toBeNull();
  });
});

describe('listeners', () => {
  beforeEach(() => initializeEchoLogging());

  it('fires on EchoSrv-driven updates and stops after unsubscribe', () => {
    const listener = jest.fn();
    const unsubscribe = onContextChange(listener);

    dispatch({
      type: 'interaction',
      payload: {
        interactionName: 'grafana_ds_add_datasource_clicked',
        properties: { plugin_id: 'prometheus' },
      },
    });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    dispatch({
      type: 'interaction',
      payload: {
        interactionName: 'dashboards_dspicker_clicked',
        properties: { ds_type: 'loki' },
      },
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('isolates listener errors so one bad listener does not block others', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const bad = jest.fn(() => {
      throw new Error('listener boom');
    });
    const good = jest.fn();

    onContextChange(bad);
    onContextChange(good);
    __notifyContextChangeForTests();

    expect(bad).toHaveBeenCalled();
    expect(good).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith('Error in context change listener', expect.any(Error), '');
    consoleSpy.mockRestore();
  });
});

describe('initializeFromRecentEvents', () => {
  beforeEach(() => initializeEchoLogging());

  it('replays the most recent buffered datasource and visualization after current values are cleared', () => {
    // Date.now() can return the same value across rapid synchronous calls,
    // which would make the buffer's sort-by-timestamp pick the wrong entry.
    // Stub it so each dispatch lands at a strictly later timestamp — that
    // mirrors the real-world case (events spaced over user-interaction time)
    // while keeping the test deterministic.
    const baseNow = 1_700_000_000_000;
    let nowOffset = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => baseNow + nowOffset);

    nowOffset = 1000;
    dispatch({
      type: 'interaction',
      payload: {
        interactionName: 'grafana_ds_add_datasource_clicked',
        properties: { plugin_id: 'old-ds' },
      },
    });
    nowOffset = 2000;
    dispatch({
      type: 'interaction',
      payload: {
        interactionName: 'dashboards_dspicker_clicked',
        properties: { ds_type: 'new-ds' },
      },
    });
    nowOffset = 3000;
    dispatch({
      type: 'interaction',
      payload: {
        interactionName: 'dashboards_panel_plugin_picker_clicked',
        properties: { plugin_id: 'gauge', item: 'select_panel_plugin' },
      },
    });

    // Simulate the "plugin reopened" scenario: the inferred values were lost
    // (e.g. ContextService was re-imported or the cache went stale) but the
    // event buffer survived. This is the only path through which
    // initializeFromRecentEvents does anything observable.
    __clearCurrentValuesForTests();
    expect(getDetectedDatasourceType()).toBeNull();
    expect(getDetectedVisualizationType()).toBeNull();

    nowOffset = 4000;
    initializeFromRecentEvents();

    // The replay must pick the MOST RECENT entry per dimension, not the first.
    expect(getDetectedDatasourceType()).toBe('new-ds');
    expect(getDetectedVisualizationType()).toBe('gauge');

    (Date.now as jest.Mock).mockRestore();
  });

  it('leaves current values untouched when no matching buffered events exist', () => {
    __clearCurrentValuesForTests();
    initializeFromRecentEvents();
    expect(getDetectedDatasourceType()).toBeNull();
    expect(getDetectedVisualizationType()).toBeNull();
  });

  it('ignores buffered events older than BUFFER_TTL', () => {
    dispatch({
      type: 'interaction',
      payload: {
        interactionName: 'grafana_ds_add_datasource_clicked',
        properties: { plugin_id: 'fresh-ds' },
      },
    });

    __clearCurrentValuesForTests();

    // Advance "now" past the 5-minute TTL. The buffer entry's timestamp was
    // captured at dispatch time; jumping Date.now forward makes it expire.
    const realNow = Date.now;
    const futureNow = realNow() + 6 * 60 * 1000;
    jest.spyOn(Date, 'now').mockImplementation(() => futureNow);

    initializeFromRecentEvents();

    expect(getDetectedDatasourceType()).toBeNull();

    (Date.now as jest.Mock).mockRestore();
  });
});
