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
        data: { href: 'https://acme.grafana.net/d/abc/board?var-user=alice@acme.com&from=now-6h', width: 1, height: 2 },
      });

      expect(scrubReplayEvent(event)).toMatchObject({
        data: { href: 'https://acme.grafana.net/d/abc/board', width: 1, height: 2 },
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
          href: '/d/abc/board?var-user=alice',
        })
      );

      expect(attributesOf(scrubReplayEvent(event))).toEqual({
        src: 'https://acme.grafana.net/avatar.png',
        href: '/d/abc/board',
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

    it('leaves in-document url(#filter) references alone', () => {
      const event = fullSnapshot(elementNode({ style: 'filter: url(#drop-shadow)' }));

      expect(attributesOf(scrubReplayEvent(event))).toEqual({ style: 'filter: url(#drop-shadow)' });
    });

    it('drops schemes a replay player has no reason to resolve', () => {
      const event = fullSnapshot(elementNode({ href: 'javascript:alert(1)', src: 'blob:https://x/abc' }));

      expect(attributesOf(scrubReplayEvent(event))).toEqual({ href: '', src: '' });
    });

    it('collapses inline data URIs and drops rasterised canvases', () => {
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
