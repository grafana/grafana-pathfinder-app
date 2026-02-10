import { parseHTMLToComponents } from './html-parser';

describe('html-parser: sandbox attribute handling', () => {
  it('preserves empty sandbox attribute as empty string (not boolean true)', () => {
    const html = `<iframe src="https://example.com" sandbox=""></iframe>`;
    const baseUrl = 'https://grafana.com/docs/test/';
    const result = parseHTMLToComponents(html, baseUrl);

    expect(result.isValid).toBe(true);
    expect(result.data).toBeTruthy();
    const iframe = (result.data as any).elements.find((el: any) => el.type === 'iframe');
    expect(iframe).toBeTruthy();
    expect(iframe.props.sandbox).toBe('');
    expect(iframe.props.sandbox).not.toBe(true);
  });

  it('sanitizer enforces maximum sandbox restrictions (empty string)', () => {
    // Even if HTML provides sandbox token values, the sanitizer replaces them with
    // empty string for maximum security (note: this test goes through sanitization)
    const html = `<iframe src="https://example.com" sandbox="allow-scripts allow-same-origin"></iframe>`;
    const baseUrl = 'https://grafana.com/docs/test/';
    const result = parseHTMLToComponents(html, baseUrl);

    expect(result.isValid).toBe(true);
    expect(result.data).toBeTruthy();
    const iframe = (result.data as any).elements.find((el: any) => el.type === 'iframe');
    expect(iframe).toBeTruthy();
    // Sanitizer enforces empty sandbox="" for maximum security, regardless of input
    expect(iframe.props.sandbox).toBe('');
  });

  it('still converts boolean attributes correctly (disabled, checked, etc)', () => {
    const html = `<input type="checkbox" disabled="" checked="">`;
    const baseUrl = 'https://grafana.com/docs/test/';
    const result = parseHTMLToComponents(html, baseUrl);

    expect(result.isValid).toBe(true);
    expect(result.data).toBeTruthy();
    const input = (result.data as any).elements.find((el: any) => el.type === 'input');
    expect(input).toBeTruthy();
    expect(input.props.disabled).toBe(true);
    expect(input.props.checked).toBe(true);
  });
});

describe('html-parser: general HTML parsing (golden path)', () => {
  it('parses typical grafana.com/docs HTML correctly', () => {
    const html = `
      <h2>Getting started</h2>
      <p>Follow these steps to <strong>configure</strong> your data source.</p>
      <pre><code class="language-yaml">apiVersion: 1
datasources:
  - name: Prometheus</code></pre>
      <img src="/static/img/docs/screenshot.png" alt="Dashboard screenshot" />
      <table>
        <thead><tr><th>Setting</th><th>Description</th></tr></thead>
        <tbody><tr><td>URL</td><td>The endpoint</td></tr></tbody>
      </table>
      <a href="/docs/grafana/latest/">Learn more</a>
    `;

    const result = parseHTMLToComponents(html);

    expect(result.isValid).toBe(true);
    expect(result.data).toBeTruthy();

    const types = result.data!.elements.map((el: any) => el.type);
    expect(types).toContain('h2');
    expect(types).toContain('p');
    expect(types).toContain('code-block');
    expect(types).toContain('image-renderer');
    expect(types).toContain('table');
    expect(types).toContain('a');
  });

  it('preserves child nesting in paragraph elements', () => {
    const html = `<p>Follow these steps to <strong>configure</strong> your data source.</p>`;

    const result = parseHTMLToComponents(html);

    expect(result.isValid).toBe(true);
    const p = result.data!.elements.find((el: any) => el.type === 'p');
    expect(p).toBeTruthy();
    // Verify <strong> is preserved as a child, not flattened
    const strongChild = (p as any).children?.find((child: any) => typeof child !== 'string' && child.type === 'strong');
    expect(strongChild).toBeTruthy();
  });

  it('maps href attribute on anchor elements', () => {
    const html = `<a href="/docs/grafana/latest/">Learn more</a>`;

    const result = parseHTMLToComponents(html);

    expect(result.isValid).toBe(true);
    const link = result.data!.elements.find((el: any) => el.type === 'a');
    expect(link).toBeTruthy();
    expect((link as any).props.href).toBe('/docs/grafana/latest/');
  });

  it('captures language class on code blocks', () => {
    const html = `<pre><code class="language-yaml">key: value</code></pre>`;

    const result = parseHTMLToComponents(html);

    expect(result.isValid).toBe(true);
    const codeBlock = result.data!.elements.find((el: any) => el.type === 'code-block');
    expect(codeBlock).toBeTruthy();
    expect((codeBlock as any).props.language).toBe('yaml');
  });

  it('parses YouTube iframes as youtube-video elements', () => {
    const html = `<iframe src="https://www.youtube.com/embed/abc123" width="560" height="315"></iframe>`;

    const result = parseHTMLToComponents(html);

    expect(result.isValid).toBe(true);
    const video = result.data!.elements.find((el: any) => el.type === 'youtube-video');
    expect(video).toBeTruthy();
    expect((video as any).props.src).toContain('youtube.com');
  });

  it('parses expandable table wrappers', () => {
    const html = `
      <div class="expand-table-wrapper">
        <table><thead><tr><th>Col</th></tr></thead><tbody><tr><td>Val</td></tr></tbody></table>
      </div>
    `;

    const result = parseHTMLToComponents(html);

    expect(result.isValid).toBe(true);
    const expandable = result.data!.elements.find((el: any) => el.type === 'expandable-table');
    expect(expandable).toBeTruthy();
  });

  it('parses collapsible sections', () => {
    const html = `
      <div class="collapse">
        <h4 class="collapse-trigger">Click to expand</h4>
        <div class="collapse-content">
          <p>Hidden content here</p>
        </div>
      </div>
    `;

    const result = parseHTMLToComponents(html);

    expect(result.isValid).toBe(true);
    // Collapsible sections render as expandable-table type with isCollapseSection flag
    const collapsible = result.data!.elements.find(
      (el: any) => el.type === 'expandable-table' && el.props?.isCollapseSection === true
    );
    expect(collapsible).toBeTruthy();
  });

  it('parses badge elements', () => {
    const html = `<badge text="Enterprise" color="blue"></badge>`;

    const result = parseHTMLToComponents(html);

    expect(result.isValid).toBe(true);
    const badge = result.data!.elements.find((el: any) => el.type === 'badge');
    expect(badge).toBeTruthy();
    expect((badge as any).props.text).toBe('Enterprise');
  });

  // Post-removal assertions
  it('renders interactive-class HTML as plain elements after removal', () => {
    const html = `
      <div class="interactive" data-targetaction="sequence">
        <h3>Step 1</h3>
        <p>Do something</p>
      </div>
    `;

    const result = parseHTMLToComponents(html);

    expect(result.isValid).toBe(true);
    // Falls through to generic HTML handler — rendered as plain div
    const div = result.data!.elements.find((el: any) => el.type === 'div');
    expect(div).toBeTruthy();
    expect(div!.props.className).toContain('interactive');
  });

  it('hasInteractiveElements is false for HTML-parsed content', () => {
    const html = `
      <div class="interactive" data-targetaction="sequence">
        <p>Steps here</p>
      </div>
    `;

    const result = parseHTMLToComponents(html);

    expect(result.isValid).toBe(true);
    expect(result.data!.hasInteractiveElements).toBe(false);
  });
});
