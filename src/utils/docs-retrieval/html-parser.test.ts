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
