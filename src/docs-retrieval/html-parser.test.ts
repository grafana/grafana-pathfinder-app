import { parseHTMLToComponents } from './html-parser';

describe('html-parser: data-showme-text', () => {
  it('surfaces data-showme-text as showMeText on interactive-step props', () => {
    const html = `
      <li class="interactive" data-targetaction="highlight" data-reftarget="a[href='/dashboards']" data-showme-text="Reveal">
        Open Dashboards
      </li>
    `;

    // Provide trusted baseUrl to pass source validation
    const baseUrl = 'https://grafana.com/docs/test/';
    const result = parseHTMLToComponents(html, baseUrl);

    expect(result.isValid).toBe(true);
    expect(result.data).toBeTruthy();
    const step = (result.data as any).elements.find((el: any) => el.type === 'interactive-step');
    expect(step).toBeTruthy();
    expect(step.props.showMeText).toBe('Reveal');
  });
});

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

describe('html-parser: guided element with div internal actions', () => {
  it('parses guided element with div.interactive internal actions correctly', () => {
    const html = `
      <div class="interactive" data-targetaction="guided">
        <p>Complete the following steps:</p>
        <div class="interactive" data-targetaction="highlight" data-reftarget="button.step1" data-requirements="exists-reftarget">
          <p>Click step 1</p>
        </div>
        <div class="interactive" data-targetaction="formfill" data-reftarget="input.step2" data-targetvalue="test" data-requirements="exists-reftarget">
          <p>Fill step 2</p>
        </div>
        <div class="interactive" data-targetaction="highlight" data-reftarget="button.step3" data-requirements="exists-reftarget">
          <p>Click step 3</p>
        </div>
      </div>
    `;

    const baseUrl = 'https://grafana.com/docs/test/';
    const result = parseHTMLToComponents(html, baseUrl);

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);

    const guided = (result.data as any).elements.find((el: any) => el.type === 'interactive-guided');
    expect(guided).toBeTruthy();
    expect(guided.props.internalActions).toHaveLength(3);

    // Verify each internal action has required attributes
    expect(guided.props.internalActions[0].targetAction).toBe('highlight');
    expect(guided.props.internalActions[0].refTarget).toBe('button.step1');

    expect(guided.props.internalActions[1].targetAction).toBe('formfill');
    expect(guided.props.internalActions[1].refTarget).toBe('input.step2');
    expect(guided.props.internalActions[1].targetValue).toBe('test');

    expect(guided.props.internalActions[2].targetAction).toBe('highlight');
    expect(guided.props.internalActions[2].refTarget).toBe('button.step3');
  });

  it('parses guided with CSS child combinator in data-reftarget (requires space before >)', () => {
    // NOTE: DOMPurify strips data-reftarget attributes containing "]>" pattern
    // (bracket immediately followed by >). To avoid this, use a space before ">".
    // Example: "div[attr] > div" works, but "div[attr]>div" gets stripped.
    const html = `<div class="interactive" data-targetaction="guided">
      <p>Steps:</p>
      <div class="interactive" data-targetaction="formfill" 
           data-reftarget="div[data-testid='portal'] > div[data-testid='input']" 
           data-targetvalue="test" data-requirements="exists-reftarget">
        <p>Fill input</p>
      </div>
    </div>`;

    const baseUrl = 'https://grafana.com/docs/test/';
    const result = parseHTMLToComponents(html, baseUrl);

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);

    const guided = (result.data as any).elements.find((el: any) => el.type === 'interactive-guided');
    expect(guided).toBeTruthy();
    expect(guided.props.internalActions).toHaveLength(1);
    // With space before >, the selector is preserved correctly
    expect(guided.props.internalActions[0].refTarget).toBe("div[data-testid='portal'] > div[data-testid='input']");
  });

  it('parses guided element inside sequence with div internal actions', () => {
    const html = `
      <div class="interactive" data-targetaction="sequence" data-reftarget="div#section">
        <div class="interactive" data-targetaction="highlight" data-reftarget="button.first" data-requirements="navmenu-open">
          <p>First step</p>
        </div>
        <div class="interactive" data-targetaction="guided">
          <p>Complete guided steps:</p>
          <div class="interactive" data-targetaction="highlight" data-reftarget="button.a" data-requirements="exists-reftarget">
            <p>Guided step A</p>
          </div>
          <div class="interactive" data-targetaction="formfill" data-reftarget="input.b" data-targetvalue="value" data-requirements="exists-reftarget">
            <p>Guided step B</p>
          </div>
        </div>
        <div class="interactive" data-targetaction="highlight" data-reftarget="button.last" data-requirements="exists-reftarget">
          <p>Last step</p>
        </div>
      </div>
    `;

    const baseUrl = 'https://grafana.com/docs/test/';
    const result = parseHTMLToComponents(html, baseUrl);

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);

    const section = (result.data as any).elements.find((el: any) => el.type === 'interactive-section');
    expect(section).toBeTruthy();
    expect(section.children).toHaveLength(3);

    // Check guided element within section
    const guided = section.children.find((el: any) => el.type === 'interactive-guided');
    expect(guided).toBeTruthy();
    expect(guided.props.internalActions).toHaveLength(2);

    expect(guided.props.internalActions[0].targetAction).toBe('highlight');
    expect(guided.props.internalActions[0].refTarget).toBe('button.a');

    expect(guided.props.internalActions[1].targetAction).toBe('formfill');
    expect(guided.props.internalActions[1].refTarget).toBe('input.b');
    expect(guided.props.internalActions[1].targetValue).toBe('value');
  });

  it('parses guided element with li.interactive internal actions correctly', () => {
    // This tests the use case where a guided block uses li elements as internal actions
    // The li elements must be wrapped in an ol/ul for valid HTML
    const html = `
      <li class="interactive" data-targetaction="guided">
        <p>Use the tool to create a new token.</p>
        <ol class="interactive-substeps">
          <li class="interactive" data-targetaction="formfill" data-reftarget="input[data-testid='token-input']" data-targetvalue="" data-requirements="exists-reftarget">
            <p>Give the token a name</p>
          </li>
          <li class="interactive" data-targetaction="highlight" data-reftarget="input.expiry" data-requirements="exists-reftarget">
            <p>Set the token expiration date</p>
          </li>
          <li class="interactive" data-targetaction="hover" data-reftarget="div.scope-info" data-requirements="exists-reftarget">
            <p>Hover to see scope details</p>
          </li>
          <li class="interactive" data-targetaction="highlight" data-reftarget="button.create" data-requirements="exists-reftarget">
            <p>Click Create token</p>
          </li>
        </ol>
      </li>
    `;

    const baseUrl = 'https://grafana.com/docs/test/';
    const result = parseHTMLToComponents(html, baseUrl);

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);

    const guided = (result.data as any).elements.find((el: any) => el.type === 'interactive-guided');
    expect(guided).toBeTruthy();
    expect(guided.props.internalActions).toHaveLength(4);

    // Verify each internal action has required attributes
    expect(guided.props.internalActions[0].targetAction).toBe('formfill');
    expect(guided.props.internalActions[0].refTarget).toBe("input[data-testid='token-input']");

    expect(guided.props.internalActions[1].targetAction).toBe('highlight');
    expect(guided.props.internalActions[1].refTarget).toBe('input.expiry');

    expect(guided.props.internalActions[2].targetAction).toBe('hover');
    expect(guided.props.internalActions[2].refTarget).toBe('div.scope-info');

    expect(guided.props.internalActions[3].targetAction).toBe('highlight');
    expect(guided.props.internalActions[3].refTarget).toBe('button.create');
  });
});
