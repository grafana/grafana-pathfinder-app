import { getDocsLinkFromEvent } from './utils.link-interception';

const DOCS_URL = 'https://grafana.com/docs/grafana/latest/alerting/fundamentals/';

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

function click(target: Element, init: MouseEventInit = {}) {
  let result: ReturnType<typeof getDocsLinkFromEvent>;
  const listener = (event: MouseEvent) => {
    result = getDocsLinkFromEvent(event);
    event.preventDefault();
  };
  document.addEventListener('click', listener, { capture: true });
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }));
  document.removeEventListener('click', listener, { capture: true });
  return result;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('getDocsLinkFromEvent', () => {
  it('returns the docs link for a click on the anchor itself', () => {
    mount(`<a id="link" href="${DOCS_URL}">Fundamentals</a>`);

    expect(click(document.getElementById('link')!)).toEqual({
      url: DOCS_URL,
      title: 'Fundamentals',
      timestamp: expect.any(Number),
    });
  });

  it.each([
    ['a LinkButton label span', `<a href="${DOCS_URL}"><span id="hit">Learn more</span></a>`],
    ['an external TextLink icon', `<a href="${DOCS_URL}" target="_blank">Docs<svg id="hit"><path d="M0 0"/></svg></a>`],
    ['a MenuItem label nested in a stack', `<a href="${DOCS_URL}"><div><span id="hit">Documentation</span></div></a>`],
  ])('reads the href from the enclosing anchor for a click on %s', (_label, html) => {
    mount(html);

    expect(click(document.getElementById('hit')!)?.url).toBe(DOCS_URL);
  });

  it('keeps tracking parameters and the hash', () => {
    const url = 'https://grafana.com/docs/grafana/latest/?utm_source=grafana_footer&utm_medium=web#intro';
    mount(`<a id="link" href="${url}">Docs</a>`);

    expect(click(document.getElementById('link')!)?.url).toBe(url);
  });

  it.each([
    ['ctrl', { ctrlKey: true }],
    ['meta', { metaKey: true }],
    ['shift', { shiftKey: true }],
    ['alt', { altKey: true }],
    ['a non-primary button', { button: 1 }],
  ])('ignores a click with %s so the browser can open a new tab', (_label, init) => {
    mount(`<a id="link" href="${DOCS_URL}">Docs</a>`);

    expect(click(document.getElementById('link')!, init)).toBeUndefined();
  });

  it.each([
    ['a non-docs host', '<a id="hit" href="https://example.com/docs/page">x</a>'],
    [
      "IRM's filtered What's new listing",
      '<a id="hit" href="https://grafana.com/docs/grafana-cloud/whats-new/?tags=IRM">x</a>',
    ],
    [
      "the What's new section, which redirects out of docs",
      '<a id="hit" href="https://grafana.com/docs/grafana-cloud/whats-new">x</a>',
    ],
    ["a What's new post", '<a id="hit" href="https://grafana.com/whats-new/2026-10-02-some-feature/">x</a>'],
    ['a docs search', '<a id="hit" href="https://grafana.com/docs/grafana/latest/?search=alerts&utm_source=x">x</a>'],
    ['the docs home', '<a id="hit" href="https://grafana.com/docs/">x</a>'],
    ['a bundled guide scheme', '<a id="hit" href="bundled:first-dashboard">x</a>'],
    ['a relative in-app route', '<a id="hit" href="/dashboards">x</a>'],
    ['a fragment', '<a id="hit" href="#section">x</a>'],
    ['a download', `<a id="hit" href="${DOCS_URL}" download>x</a>`],
    ['an element outside any anchor', '<button id="hit">x</button>'],
    ['Pathfinder content', `<div data-pathfinder-content><a id="hit" href="${DOCS_URL}">x</a></div>`],
    ['the block editor', `<div class="ProseMirror"><a id="hit" href="${DOCS_URL}">x</a></div>`],
  ])('ignores %s', (_label, html) => {
    mount(html);

    expect(click(document.getElementById('hit')!)).toBeUndefined();
  });

  it('ignores a click another handler already took', () => {
    mount(`<a id="link" href="${DOCS_URL}">Docs</a>`);
    const takeFirst = (event: Event) => event.preventDefault();
    window.addEventListener('click', takeFirst, { capture: true });

    try {
      expect(click(document.getElementById('link')!)).toBeUndefined();
    } finally {
      window.removeEventListener('click', takeFirst, { capture: true });
    }
  });
});
