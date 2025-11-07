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
