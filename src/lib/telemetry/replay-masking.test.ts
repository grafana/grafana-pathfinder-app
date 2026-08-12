/**
 * Pins the jsdom URL so the recorded `Meta` href and the relative `<a href>`
 * resolve to something assertable.
 *
 * @jest-environment-options {"url": "https://foo.grafana.net/d/abc123/acme-corp-quarterly-revenue?var-customer=AcmeCorpFilterValue&orgId=1"}
 */
import {
  BaseTransport,
  initializeFaro,
  SessionInstrumentation,
  type Faro,
  type TransportItem,
} from '@grafana/faro-web-sdk';
import { activateSessionReplay } from './replay';
import { redactPageUrl } from './filtering';

const REPLAY_INSTRUMENTATION_NAME = '@grafana/faro-instrumentation-replay';

class CaptureTransport extends BaseTransport {
  readonly name = '@pathfinder/replay-masking-transport';
  readonly version = '0.0.0';
  items: TransportItem[] = [];
  send(items: TransportItem | TransportItem[]): void {
    this.items.push(...(Array.isArray(items) ? items : [items]));
  }
}

// Everything else in the suite is structural: faro.test.ts asserts the masking
// *options* are set, replay-scrub.test.ts runs the scrubber over hand-built
// events. Neither would notice an SDK or rrweb bump that renamed an option or
// changed what `maskTextSelector: '*'` means — the tests would stay green while
// an unmasked recording shipped. This one drives the real recorder over a real
// DOM and reads what actually reaches the transport.
describe('what the real recorder actually sends', () => {
  const transport = new CaptureTransport();
  const SECRETS = {
    heading: 'AcmeCorpQuarterlyRevenue',
    paragraph: 'alice@acme.example',
    inputValue: 'hunter2password',
    ariaLabel: 'ProductionBillingPanel',
    testId: 'Panel header AcmeCorpQuarterlyRevenue',
    title: 'ConfidentialTooltip',
    placeholder: 'EnterYourEmailAddress',
    comment: 'InternalCommentSecret',
    imageQuery: 'signedtokenvalue',
    // rrweb exempts <style> text from masking, so CSS is a text channel of its
    // own — one a third-party panel can write customer data into.
    cssContent: 'CssRenderedTenantName',
    cssCustomProperty: 'CssCustomPropertySecret',
    // An apostrophe and an escaped quote each end a naive quoted-string match
    // early, leaving the tail outside it.
    cssApostrophe: "CssApostropheSecret'sTail",
    cssEscapedQuote: 'CssEscapedQuote\\"Tail',
    // Not in the DOM — this one rides in on location.href via the page meta.
    urlFilterValue: 'AcmeCorpFilterValue',
  };

  let faro: Faro;
  let recorded: string;
  let pageUrls: string[];

  beforeAll(async () => {
    document.body.innerHTML = `
      <style>
        .tenant::after{content:"${SECRETS.cssContent}"}
        .apostrophe::after{content:"${SECRETS.cssApostrophe}"}
        .escaped::after{content:"${SECRETS.cssEscapedQuote}"}
      </style>
      <div id="fixture" aria-label="${SECRETS.ariaLabel}" data-testid="${SECRETS.testId}" title="${SECRETS.title}"
           style="--tenant-name: '${SECRETS.cssCustomProperty}'">
        <h1>${SECRETS.heading}</h1>
        <p>${SECRETS.paragraph}</p>
        <!-- ${SECRETS.comment} -->
        <input type="text" value="${SECRETS.inputValue}" placeholder="${SECRETS.placeholder}" />
        <img src="https://acme.grafana.net/chart.png?sig=${SECRETS.imageQuery}" alt="secret alt text" />
        <a href="/d/abc123/acme-corp-quarterly-revenue">board</a>
      </div>`;

    faro = initializeFaro({
      app: { name: 'pathfinder-replay-masking', version: '0.0.0' },
      transports: [transport],
      instrumentations: [new SessionInstrumentation()],
      sessionTracking: { enabled: true, persistent: false },
      isolate: true,
      globalObjectKey: 'pathfinderReplayMasking',
      batching: { enabled: false },
      dedupe: false,
      // Mirrors the production beforeSend so the transport metadata assertions
      // below exercise the real redaction rather than a stand-in.
      beforeSend: (item) => redactPageUrl(item),
    });
    await activateSessionReplay(faro);

    const replayItems = transport.items.filter(
      (item) => item.type === 'event' && (item.payload as { name?: string }).name === 'faro.session_recording.event'
    );
    recorded = replayItems
      .map((item) => JSON.stringify((item.payload as { attributes?: Record<string, string> }).attributes ?? {}))
      .join('\n');
    // The transport metadata is a second channel out, set by Faro from
    // location.href rather than by anything in the rrweb payload.
    pageUrls = [...new Set(transport.items.map((item) => item.meta.page?.url ?? ''))].filter(Boolean);
  });

  // rrweb keeps a MutationObserver on the document; left running it emits into
  // a torn-down environment once the suite finishes.
  afterAll(() => {
    const recorder = faro.instrumentations.instrumentations.find((i) => i.name === REPLAY_INSTRUMENTATION_NAME);
    if (recorder) {
      faro.instrumentations.remove(recorder);
    }
  });

  it('records something at all — otherwise the assertions below are vacuous', () => {
    expect(recorded.length).toBeGreaterThan(0);
    expect(recorded).toContain('fixture');
  });

  it.each(Object.entries(SECRETS))('does not leak the %s', (_label, secret) => {
    expect(recorded).not.toContain(secret);
  });

  it('masks rendered text rather than dropping the nodes that held it', () => {
    expect(recorded).toContain('*');
  });

  // The board path is deliberately kept — it is what makes a replay navigable.
  // The query is not: `var-*` values are user-selected filter text.
  it('keeps the dashboard path and drops the query', () => {
    expect(recorded).toContain('/d/abc123/acme-corp-quarterly-revenue');
    expect(recorded).not.toContain(SECRETS.imageQuery);
  });

  // Faro sets meta.page.url from location.href independently of the rrweb
  // payload, and Grafana Cloud's collector explodes its query into
  // page.attributes — so an unscrubbed query arrives as searchable var-* fields.
  it('sends a page url on the transport metadata', () => {
    expect(pageUrls.length).toBeGreaterThan(0);
    expect(pageUrls.every((url) => url.includes('/d/abc123/acme-corp-quarterly-revenue'))).toBe(true);
  });

  it('strips the query from that page url', () => {
    expect(pageUrls.every((url) => !url.includes('?'))).toBe(true);
  });
});
