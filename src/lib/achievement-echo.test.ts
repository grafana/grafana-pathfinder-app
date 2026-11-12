import {
  MAX_BUFFERED_ECHO_EVENTS,
  applyEchoSources,
  attachEchoSink,
  closeEchoSubscriptions,
  echoWhenHolds,
  installEchoSubscriptions,
  pickEchoProperties,
  subscribedEchoNames,
  __resetEchoSourcesForTests,
  type EchoEvent,
  type EchoSource,
} from './achievement-echo';

const OWNER = 'user-1:org-1';
const CACHE_KEY = `grafana-pathfinder-app-achievement-sources-v1:${OWNER}`;

const created: EchoSource = {
  interaction: 'grafana_dashboard_created',
  properties: ['result', 'uid'],
  when: [{ property: 'result', op: 'eq', value: 'success' }],
};
const ruleSaved: EchoSource = { interaction: 'grafana_alerting_rule_saved', properties: ['formAction'] };

function fakeEcho() {
  const listeners = new Map<string, Set<(properties: Record<string, unknown>) => void>>();
  const subscribe = jest.fn((name: string, callback: (properties: Record<string, unknown>) => void) => {
    const set = listeners.get(name) ?? new Set();
    set.add(callback);
    listeners.set(name, set);
    return () => {
      set.delete(callback);
    };
  });
  return {
    subscribe,
    report: (name: string, properties: Record<string, unknown>) => listeners.get(name)?.forEach((cb) => cb(properties)),
    listening: () => [...listeners].filter(([, set]) => set.size > 0).map(([name]) => name),
  };
}

function install(echo = fakeEcho(), owner: string | null = OWNER) {
  installEchoSubscriptions({ subscribe: echo.subscribe, ownerKey: () => owner, now: () => 1000 });
  return echo;
}

function collect(): EchoEvent[] {
  const events: EchoEvent[] = [];
  attachEchoSink((event) => events.push(event));
  return events;
}

beforeEach(() => {
  __resetEchoSourcesForTests();
  localStorage.clear();
});

describe('feature detection', () => {
  it('does nothing below Grafana 13.2, where onInteraction does not exist', () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify([created]));
    expect(() => {
      installEchoSubscriptions({ subscribe: undefined, ownerKey: () => OWNER });
      applyEchoSources([ruleSaved]);
      attachEchoSink(() => undefined);
      closeEchoSubscriptions();
    }).not.toThrow();
    expect(subscribedEchoNames()).toEqual([]);
    expect(localStorage.getItem(CACHE_KEY)).toBe(JSON.stringify([created]));
  });

  it('does nothing without a signed-in owner', () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify([created]));
    const echo = install(fakeEcho(), null);
    expect(echo.subscribe).not.toHaveBeenCalled();
  });

  it('subscribes only from the cached list of the signed-in owner', () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify([created]));
    localStorage.setItem('grafana-pathfinder-app-achievement-sources-v1:user-2:org-1', JSON.stringify([ruleSaved]));
    const echo = install();
    expect(echo.listening()).toEqual(['grafana_dashboard_created']);
  });

  it('subscribes to nothing when the cache is missing or unreadable', () => {
    localStorage.setItem(CACHE_KEY, '{not json');
    const echo = install();
    expect(echo.subscribe).not.toHaveBeenCalled();
    applyEchoSources([created]);
    expect(echo.listening()).toEqual(['grafana_dashboard_created']);
    expect(JSON.parse(localStorage.getItem(CACHE_KEY)!)).toEqual([created]);
  });
});

describe('buffer', () => {
  it('holds events until a sink attaches, then hands them over in order and delivers live ones', () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify([created]));
    const echo = install();
    echo.report('grafana_dashboard_created', { uid: 'a', result: 'success' });
    echo.report('grafana_dashboard_created', { uid: 'b', result: 'success' });
    const events = collect();
    echo.report('grafana_dashboard_created', { uid: 'c', result: 'success' });
    expect(events.map((e) => e.properties.uid)).toEqual(['a', 'b', 'c']);
    expect(events[0]).toEqual({
      source: 'grafana_dashboard_created',
      properties: { uid: 'a', result: 'success' },
      occurredAt: 1000,
    });
  });

  it(`keeps only the newest ${MAX_BUFFERED_ECHO_EVENTS} events`, () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify([created]));
    const echo = install();
    for (let i = 0; i < MAX_BUFFERED_ECHO_EVENTS + 5; i++) {
      echo.report('grafana_dashboard_created', { uid: `d-${i}`, result: 'success' });
    }
    const events = collect();
    expect(events).toHaveLength(MAX_BUFFERED_ECHO_EVENTS);
    expect(events[0]?.properties.uid).toBe('d-5');
    expect(events.at(-1)?.properties.uid).toBe(`d-${MAX_BUFFERED_ECHO_EVENTS + 4}`);
  });

  it('discards held events, unsubscribes and forgets the cache when closed', () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify([created]));
    const echo = install();
    echo.report('grafana_dashboard_created', { uid: 'a', result: 'success' });
    closeEchoSubscriptions();
    const events = collect();
    echo.report('grafana_dashboard_created', { uid: 'b', result: 'success' });
    expect(events).toEqual([]);
    expect(echo.listening()).toEqual([]);
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
  });

  it('never throws into the host when the sink fails', () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify([created]));
    const echo = install();
    attachEchoSink(() => {
      throw new Error('boom');
    });
    expect(() => echo.report('grafana_dashboard_created', { uid: 'a', result: 'success' })).not.toThrow();
  });
});

describe('applyEchoSources', () => {
  it('subscribes new names, drops removed ones and refreshes the cache', () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify([created]));
    const echo = install();
    applyEchoSources([ruleSaved, { interaction: '', properties: [] }, { interaction: 'x' }]);
    expect(echo.listening()).toEqual(['grafana_alerting_rule_saved']);
    expect(JSON.parse(localStorage.getItem(CACHE_KEY)!)).toEqual([ruleSaved]);
  });

  it('applies a changed property list to an existing subscription without resubscribing', () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify([created]));
    const echo = install();
    const events = collect();
    applyEchoSources([{ interaction: 'grafana_dashboard_created', properties: ['uid', 'numPanels'] }]);
    echo.report('grafana_dashboard_created', { uid: 'a', numPanels: 2, result: 'failure' });
    expect(echo.subscribe).toHaveBeenCalledTimes(1);
    expect(events.map((e) => e.properties)).toEqual([{ uid: 'a', numPanels: 2 }]);
  });

  it('keeps the other subscriptions when one subscribe throws', () => {
    const echo = install();
    echo.subscribe.mockImplementationOnce(() => {
      throw new Error('no echo service yet');
    });
    applyEchoSources([created, ruleSaved]);
    expect(subscribedEchoNames()).toEqual(['grafana_alerting_rule_saved']);
  });
});

describe('pickEchoProperties', () => {
  it('forwards only listed, own, scalar properties', () => {
    const raw = Object.assign(Object.create({ inherited: 'x' }), {
      uid: 'abc',
      numPanels: 3,
      starred: false,
      title: 'Prod',
      nan: Number.NaN,
      nested: { a: 1 },
      list: [1],
      empty: null,
    });
    const source: EchoSource = {
      interaction: 'i',
      properties: ['uid', 'numPanels', 'starred', 'nan', 'nested', 'list', 'empty', 'inherited', 'missing'],
    };
    expect(pickEchoProperties(source, raw)).toEqual({ uid: 'abc', numPanels: 3, starred: false });
  });
});

describe('echoWhenHolds', () => {
  const source = (when: EchoSource['when']): EchoSource => ({ interaction: 'i', properties: [], when });

  it.each([
    ['eq match', [{ property: 'result', op: 'eq', value: 'success' }], { result: 'success' }, true],
    ['eq mismatch', [{ property: 'result', op: 'eq', value: 'success' }], { result: 'error' }, false],
    ['eq number', [{ property: 'n', op: 'eq', value: 2 }], { n: 2 }, true],
    ['in match', [{ property: 'f', op: 'in', value: ['create', 'copy'] }], { f: 'copy' }, true],
    ['in mismatch', [{ property: 'f', op: 'in', value: ['create'] }], { f: 'edit' }, false],
    ['missing property', [{ property: 'result', op: 'eq', value: 'success' }], {}, false],
    [
      'all must hold',
      [
        { property: 'a', op: 'eq', value: 1 },
        { property: 'b', op: 'eq', value: 2 },
      ],
      { a: 1, b: 3 },
      false,
    ],
    ['unknown op is left to the backend', [{ property: 'n', op: 'gte', value: 1 }], {}, true],
    ['no conditions', undefined, {}, true],
  ])('%s', (_name, when, properties, expected) => {
    expect(echoWhenHolds(source(when), properties)).toBe(expected);
  });
});
