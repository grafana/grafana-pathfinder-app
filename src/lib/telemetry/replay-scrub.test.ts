import type { ReplayInstrumentationOptions } from '@grafana/faro-instrumentation-replay';
import { scrubReplayEvent } from './replay-scrub';

type ReplayEvent = Parameters<NonNullable<ReplayInstrumentationOptions['beforeSend']>>[0];

const asEvent = (event: unknown) => event as ReplayEvent;

const elementNode = (attributes: Record<string, unknown>, childNodes: unknown[] = []) => ({
  type: 2,
  tagName: 'div',
  id: 1,
  attributes,
  childNodes,
});

const fullSnapshot = (node: unknown) => asEvent({ type: 2, timestamp: 0, data: { node, initialOffset: {} } });

const mutation = (data: Record<string, unknown>) =>
  asEvent({ type: 3, timestamp: 0, data: { source: 0, texts: [], removes: [], adds: [], attributes: [], ...data } });

const attributesOf = (event: ReplayEvent) =>
  (event as unknown as { data: { node: { attributes: Record<string, unknown> } } }).data.node.attributes;

describe('scrubReplayEvent', () => {
  describe('meta events', () => {
    it('strips the query string from the recorded page URL', () => {
      const event = asEvent({
        type: 4,
        timestamp: 0,
        data: {
          href: 'https://acme.grafana.net/d/abc/acme-revenue?var-user=alice@acme.com&from=now-6h',
          width: 1,
          height: 2,
        },
      });

      expect(scrubReplayEvent(event)).toMatchObject({
        data: { href: 'https://acme.grafana.net/d/abc/acme-revenue', width: 1, height: 2 },
      });
    });
  });

  describe('full snapshots', () => {
    it('drops attributes that carry rendered text', () => {
      const event = fullSnapshot(
        elementNode({
          'aria-label': 'CPU usage by pod',
          'data-testid': 'Panel header Production revenue',
          title: 'alice@acme.com',
          alt: 'Screenshot of the billing page',
          placeholder: 'Enter your email',
          value: 'secret',
          name: 'customer',
        })
      );

      expect(attributesOf(scrubReplayEvent(event))).toEqual({});
    });

    it('keeps the attributes the replay needs to render', () => {
      const attributes = {
        class: 'css-1x2y3z panel-container',
        style: 'width: 100px',
        id: 'panel-4',
        role: 'button',
        'aria-expanded': 'true',
        d: 'M0 0 L10 10',
        viewBox: '0 0 24 24',
        fill: 'currentColor',
        _cssText: '.css-1x2y3z{color:red}',
      };

      expect(attributesOf(scrubReplayEvent(fullSnapshot(elementNode({ ...attributes }))))).toEqual(attributes);
    });

    it('scrubs nested children, not just the root', () => {
      const event = fullSnapshot(
        elementNode({ class: 'root' }, [
          elementNode({ class: 'mid' }, [elementNode({ class: 'leaf', 'aria-label': 'Revenue by customer' })]),
        ])
      );

      const root = (
        scrubReplayEvent(event) as unknown as {
          data: { node: { childNodes: Array<{ childNodes: Array<{ attributes: Record<string, unknown> }> }> } };
        }
      ).data.node;

      expect(root.childNodes[0]!.childNodes[0]!.attributes).toEqual({ class: 'leaf' });
    });

    it('redacts URL attributes without breaking them', () => {
      const event = fullSnapshot(
        elementNode({
          src: 'https://acme.grafana.net/avatar.png?token=abc123',
          href: '/d/abc/acme-revenue?var-user=alice',
        })
      );

      expect(attributesOf(scrubReplayEvent(event))).toEqual({
        src: 'https://acme.grafana.net/avatar.png',
        href: '/d/abc/acme-revenue',
      });
    });

    it('leaves in-document icon references intact', () => {
      const event = fullSnapshot(elementNode({ 'xlink:href': '#icon-angle-down', href: '#icon-angle-down' }));

      expect(attributesOf(scrubReplayEvent(event))).toEqual({
        'xlink:href': '#icon-angle-down',
        href: '#icon-angle-down',
      });
    });

    it('strips query strings from url() inside inline styles', () => {
      const event = fullSnapshot(
        elementNode({
          style: "background-image: url('https://acme.grafana.net/bg.png?sig=abc123'); color: red",
        })
      );

      expect(attributesOf(scrubReplayEvent(event))).toEqual({
        style: 'background-image: url("https://acme.grafana.net/bg.png"); color: red',
      });
    });

    it('strips query strings from url() inside serialized stylesheets', () => {
      const event = fullSnapshot(
        elementNode({ _cssText: '.a{background:url(https://acme.grafana.net/x.svg?token=t)}.b{color:red}' })
      );

      expect(attributesOf(scrubReplayEvent(event))).toEqual({
        _cssText: '.a{background:url("https://acme.grafana.net/x.svg")}.b{color:red}',
      });
    });

    it('strips query strings from <style> text, which rrweb never masks', () => {
      const styleNode = {
        type: 2,
        tagName: 'style',
        id: 5,
        attributes: {},
        childNodes: [{ type: 3, id: 6, textContent: '.a{background:url(https://acme.grafana.net/y.png?sig=s)}' }],
      };

      scrubReplayEvent(fullSnapshot(styleNode));

      expect(styleNode.childNodes[0]!.textContent).toBe('.a{background:url("https://acme.grafana.net/y.png")}');
    });

    // A quoted CSS url() may legally contain parentheses; an unquoted one may
    // not. Matching both with one "stop at the first )" rule silently skipped
    // the quoted case.
    it.each([
      ['double-quoted with parentheses', 'url("https://acme.grafana.net/a(1).png?sig=s")'],
      ['single-quoted with parentheses', "url('https://acme.grafana.net/a(1).png?sig=s')"],
      ['padded with whitespace', 'url(  "https://acme.grafana.net/a(1).png?sig=s"  )'],
    ])('scrubs a %s url()', (_label, css) => {
      const event = fullSnapshot(elementNode({ style: `background-image: ${css}` }));

      expect(attributesOf(scrubReplayEvent(event))).toEqual({
        style: 'background-image: url("https://acme.grafana.net/a(1).png")',
      });
    });

    it('collapses a quoted data: URI containing parentheses', () => {
      const event = fullSnapshot(
        elementNode({ style: 'background: url("data:image/svg+xml,<svg><path d=\'M0 0\'/></svg>)")' })
      );

      expect(attributesOf(scrubReplayEvent(event))).toEqual({ style: 'background: url("data:")' });
    });

    it('scrubs every url() in a rule, not just the first', () => {
      const event = fullSnapshot(
        elementNode({
          _cssText: '.a{background:url("https://acme.grafana.net/1.png?k=v")}.b{background:url(/2.png?k=v)}',
        })
      );

      expect(attributesOf(scrubReplayEvent(event))).toEqual({
        _cssText: '.a{background:url("https://acme.grafana.net/1.png")}.b{background:url("/2.png")}',
      });
    });

    it.each(['URL', 'Url', 'uRl'])('scrubs %s() — CSS keywords are case-insensitive', (keyword) => {
      const event = fullSnapshot(
        elementNode({ style: `background: ${keyword}("https://acme.grafana.net/c.png?token=t")` })
      );

      expect(attributesOf(scrubReplayEvent(event))).toEqual({
        style: 'background: url("https://acme.grafana.net/c.png")',
      });
    });

    // Not every CSS resource reference is wrapped in url().
    it('scrubs @import, which takes a bare string', () => {
      const event = fullSnapshot(
        elementNode({ _cssText: '@import "https://acme.grafana.net/sheet.css?token=t"; .a{color:red}' })
      );

      expect(attributesOf(scrubReplayEvent(event))).toEqual({
        _cssText: '@import "https://acme.grafana.net/sheet.css"; .a{color:red}',
      });
    });

    it('scrubs the bare-string form of image-set()', () => {
      const event = fullSnapshot(
        elementNode({
          style: 'background: image-set("https://acme.grafana.net/a.png?sig=s" 1x, "/b.png?sig=s" 2x)',
        })
      );

      expect(attributesOf(scrubReplayEvent(event))).toEqual({
        style: 'background: image-set("https://acme.grafana.net/a.png" 1x, "/b.png" 2x)',
      });
    });

    // A match that stops at the first `)` ends inside the argument list, so
    // every entry after the first url() — or after a filename with a paren in
    // it — went unscrubbed.
    it('scrubs bare strings that follow a url() entry in the same image-set()', () => {
      const event = fullSnapshot(
        elementNode({ style: 'background: image-set(url(/a.png?sig=s) 1x, "/b.png?sig=s" 2x)' })
      );

      expect(attributesOf(scrubReplayEvent(event))).toEqual({
        style: 'background: image-set(url("/a.png") 1x, "/b.png" 2x)',
      });
    });

    it('scrubs an image-set() whose first entry contains a parenthesis', () => {
      const event = fullSnapshot(
        elementNode({ style: 'background: -webkit-image-set("/a(1).png?sig=s" 1x, "/c.png?sig=s" 2x)' })
      );

      expect(attributesOf(scrubReplayEvent(event))).toEqual({
        style: 'background: -webkit-image-set("/a(1).png" 1x, "/c.png" 2x)',
      });
    });

    it('leaves the MIME type in an image-set() type() descriptor alone', () => {
      const event = fullSnapshot(
        elementNode({ style: 'background: image-set("/a.avif?sig=s" type("image/avif"), "/b.png" type("image/png"))' })
      );

      expect(attributesOf(scrubReplayEvent(event))).toEqual({
        style: 'background: image-set("/a.avif" type("image/avif"), "/b.png" type("image/png"))',
      });
    });

    it('keeps the density descriptors it walks past', () => {
      const event = fullSnapshot(
        elementNode({ style: 'background: image-set("/a.png" 1x, "/b.png" 2dppx) no-repeat' })
      );

      expect(attributesOf(scrubReplayEvent(event))).toEqual({
        style: 'background: image-set("/a.png" 1x, "/b.png" 2dppx) no-repeat',
      });
    });

    // rrweb exempts stylesheet text from masking, so a third-party panel that
    // renders customer text through CSS bypasses maskTextSelector entirely.
    it('masks text rendered by content:, which rrweb never masks', () => {
      const event = fullSnapshot(elementNode({ _cssText: '.a::after{content:"alice@acme.com";color:red}' }));

      expect(attributesOf(scrubReplayEvent(event))).toEqual({
        _cssText: '.a::after{content:"**************";color:red}',
      });
    });

    // `;` and `}` are legal inside a quoted string, so a value pattern that
    // stops at either ends mid-string and masks nothing.
    it.each([
      ['a semicolon', 'alice;bob@acme.com', '"******************"'],
      ['a closing brace', 'alice}bob@acme.com', '"******************"'],
    ])('masks a content string containing %s', (_label, secret, expected) => {
      const event = fullSnapshot(elementNode({ _cssText: `.a::after{content:"${secret}";color:red}` }));

      expect(attributesOf(scrubReplayEvent(event))).toEqual({
        _cssText: `.a::after{content:${expected};color:red}`,
      });
    });

    it('masks text held in a custom property', () => {
      const event = fullSnapshot(elementNode({ style: '--tenant-name: "Acme Corp"; color: red' }));

      expect(attributesOf(scrubReplayEvent(event))).toEqual({ style: '--tenant-name: "**** ****"; color: red' });
    });

    it('keeps escape sequences so icon glyphs still render', () => {
      const event = fullSnapshot(elementNode({ _cssText: '.i::before{content:"\\e900"}' }));

      expect(attributesOf(scrubReplayEvent(event))).toEqual({ _cssText: '.i::before{content:"\\e900"}' });
    });

    it('leaves a resource-bearing content value to the url() pass', () => {
      const event = fullSnapshot(elementNode({ style: 'content: url("https://acme.grafana.net/i.png?sig=s")' }));

      expect(attributesOf(scrubReplayEvent(event))).toEqual({
        style: 'content: url("https://acme.grafana.net/i.png")',
      });
    });

    it('leaves align-content and justify-content alone', () => {
      const event = fullSnapshot(elementNode({ style: 'align-content: center; justify-content: space-between' }));

      expect(attributesOf(scrubReplayEvent(event))).toEqual({
        style: 'align-content: center; justify-content: space-between',
      });
    });

    // rrweb masks TEXT_NODEs only, so a comment reaches the collector verbatim.
    it('masks comment nodes, which rrweb serializes as written', () => {
      const commented = {
        type: 2,
        tagName: 'div',
        id: 1,
        attributes: {},
        childNodes: [{ type: 5, id: 2, textContent: ' TODO: alice@acme.com owns this panel ' }],
      };

      scrubReplayEvent(fullSnapshot(commented));

      const masked = commented.childNodes[0]!.textContent;
      expect(masked).not.toContain('alice@acme.com');
      expect(masked).toMatch(/^[\s*]+$/);
      expect(masked).toHaveLength(' TODO: alice@acme.com owns this panel '.length);
    });

    it('leaves in-document url(#filter) references alone', () => {
      const event = fullSnapshot(elementNode({ style: 'filter: url(#drop-shadow)' }));

      expect(attributesOf(scrubReplayEvent(event))).toEqual({ style: 'filter: url(#drop-shadow)' });
    });

    it('drops schemes a replay player has no reason to resolve', () => {
      const event = fullSnapshot(elementNode({ href: 'javascript:alert(1)', src: 'blob:https://x/abc' }));

      expect(attributesOf(scrubReplayEvent(event))).toEqual({ href: '', src: '' });
    });

    it('collapses inline data URIs and drops rasterized canvases', () => {
      const event = fullSnapshot(
        elementNode({ src: 'data:image/png;base64,iVBORw0KGgoAAAA', rr_dataURL: 'data:image/png;base64,iVBORw0K' })
      );

      expect(attributesOf(scrubReplayEvent(event))).toEqual({ src: 'data:' });
    });
  });

  describe('incremental mutations', () => {
    it('scrubs nodes added after the snapshot', () => {
      const event = mutation({
        adds: [{ parentId: 1, nextId: null, node: elementNode({ class: 'toast', title: 'Query failed for alice' }) }],
      });

      const added = (event as unknown as { data: { adds: Array<{ node: { attributes: Record<string, unknown> } }> } })
        .data.adds[0]!;

      scrubReplayEvent(event);

      expect(added.node.attributes).toEqual({ class: 'toast' });
    });

    it('scrubs attribute changes on existing nodes', () => {
      const event = mutation({
        attributes: [{ id: 7, attributes: { class: 'panel is-loading', 'aria-label': 'Errors by service' } }],
      });

      const changed = (event as unknown as { data: { attributes: Array<{ attributes: Record<string, unknown> }> } })
        .data.attributes[0]!;

      scrubReplayEvent(event);

      expect(changed.attributes).toEqual({ class: 'panel is-loading' });
    });

    it('scrubs style text changed after the snapshot', () => {
      const event = mutation({ texts: [{ id: 6, value: '.a{background:url(https://acme.grafana.net/z.png?k=v)}' }] });
      const texts = (event as unknown as { data: { texts: Array<{ value: string }> } }).data.texts;

      scrubReplayEvent(event);

      expect(texts[0]!.value).toBe('.a{background:url("https://acme.grafana.net/z.png")}');
    });

    it('scrubs the styleOMValue diff an attribute mutation carries', () => {
      const event = mutation({
        attributes: [
          {
            id: 7,
            attributes: {
              style: {
                'background-image': 'url(https://acme.grafana.net/a.png?k=v)',
                'border-image': ['url(https://acme.grafana.net/b.png?k=v)', 'important'],
              },
            },
          },
        ],
      });
      const changed = (
        event as unknown as {
          data: { attributes: Array<{ attributes: { style: Record<string, unknown> } }> };
        }
      ).data.attributes[0]!;

      scrubReplayEvent(event);

      expect(changed.attributes.style).toEqual({
        'background-image': 'url("https://acme.grafana.net/a.png")',
        'border-image': ['url("https://acme.grafana.net/b.png")', 'important'],
      });
    });

    // A CSSOM diff carries the property name separately, so the value alone
    // has no `content:` for the declaration pattern to key off.
    it('masks a content write in the styleOMValue diff', () => {
      const event = mutation({
        attributes: [{ id: 8, attributes: { style: { content: '"alice@acme.com"' } } }],
      });
      const changed = (
        event as unknown as { data: { attributes: Array<{ attributes: { style: Record<string, unknown> } }> } }
      ).data.attributes[0]!;

      scrubReplayEvent(event);

      expect(changed.attributes.style).toEqual({ content: '"**************"' });
    });
  });

  // Emotion's insertRule traffic and React's inline-style writes never appear
  // as DOM mutations — each is its own incremental source.
  describe('CSS-bearing incremental sources', () => {
    const incremental = (source: number, data: Record<string, unknown>) =>
      asEvent({ type: 3, timestamp: 0, data: { source, ...data } });

    const dataOf = (event: ReplayEvent) => (event as unknown as { data: Record<string, unknown> }).data;

    it('scrubs inserted stylesheet rules (Emotion insertRule)', () => {
      const event = incremental(8, {
        id: 3,
        adds: [{ rule: '.x{background:url(https://acme.grafana.net/i.png?sig=s)}', index: 0 }],
      });

      scrubReplayEvent(event);

      expect((dataOf(event).adds as Array<{ rule: string }>)[0]!.rule).toBe(
        '.x{background:url("https://acme.grafana.net/i.png")}'
      );
    });

    it('scrubs wholesale stylesheet replacement', () => {
      const event = incremental(8, {
        id: 3,
        replace: '.y{background:url(https://acme.grafana.net/r.png?sig=s)}',
        replaceSync: '.z{background:url(https://acme.grafana.net/s.png?sig=s)}',
      });

      scrubReplayEvent(event);

      expect(dataOf(event)).toMatchObject({
        replace: '.y{background:url("https://acme.grafana.net/r.png")}',
        replaceSync: '.z{background:url("https://acme.grafana.net/s.png")}',
      });
    });

    it('scrubs adopted stylesheets', () => {
      const event = incremental(15, {
        id: 1,
        styleIds: [2],
        styles: [{ styleId: 2, rules: [{ rule: '.a{background:url(https://acme.grafana.net/ad.png?sig=s)}' }] }],
      });

      scrubReplayEvent(event);

      const styles = dataOf(event).styles as Array<{ rules: Array<{ rule: string }> }>;
      expect(styles[0]!.rules[0]!.rule).toBe('.a{background:url("https://acme.grafana.net/ad.png")}');
    });

    it('scrubs single style-property writes', () => {
      const event = incremental(13, {
        id: 4,
        index: [0],
        set: { property: 'background-image', value: 'url(https://acme.grafana.net/d.png?sig=s)', priority: undefined },
      });

      scrubReplayEvent(event);

      expect((dataOf(event).set as { value: string }).value).toBe('url("https://acme.grafana.net/d.png")');
    });

    it('masks a single content write', () => {
      const event = incremental(13, {
        id: 4,
        index: [0],
        set: { property: 'content', value: '"alice@acme.com"', priority: undefined },
      });

      scrubReplayEvent(event);

      expect((dataOf(event).set as { value: string }).value).toBe('"**************"');
    });

    it('masks text in an inserted rule, not just its urls', () => {
      const event = incremental(8, {
        id: 3,
        adds: [{ rule: '.x::after{content:"alice@acme.com"}', index: 0 }],
      });

      scrubReplayEvent(event);

      expect((dataOf(event).adds as Array<{ rule: string }>)[0]!.rule).toBe('.x::after{content:"**************"}');
    });

    it('scrubs font sources, which are bare URLs rather than CSS', () => {
      const event = incremental(10, {
        family: 'Inter',
        fontSource: 'https://acme.grafana.net/inter.woff2?sig=s',
        buffer: false,
      });

      scrubReplayEvent(event);

      expect(dataOf(event).fontSource).toBe('https://acme.grafana.net/inter.woff2');
    });
  });

  describe('other incremental sources', () => {
    it('leaves non-mutation sources alone', () => {
      const event = asEvent({ type: 3, timestamp: 0, data: { source: 2, type: 2, id: 9, x: 10, y: 20 } });

      expect(scrubReplayEvent(event)).toMatchObject({ data: { source: 2, id: 9, x: 10, y: 20 } });
    });
  });

  it('passes through event shapes it does not recognise', () => {
    const event = asEvent({ type: 99, timestamp: 0, data: { anything: 'preserved' } });

    expect(scrubReplayEvent(event)).toMatchObject({ data: { anything: 'preserved' } });
  });

  it('tolerates events with no data object', () => {
    const event = asEvent({ type: 2, timestamp: 0 });

    expect(() => scrubReplayEvent(event)).not.toThrow();
  });
});
