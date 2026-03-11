/**
 * Tests for markdown block image resolution in the JSON parser.
 */

import { parseJsonGuide, parseMarkdownToElements } from './json-parser';

// Mock Grafana runtime
jest.mock('@grafana/runtime', () => ({
  config: { bootData: { user: null }, buildInfo: { version: '10.0.0' } },
}));

// Mock @grafana/data renderMarkdown to produce img tags from markdown syntax
jest.mock('@grafana/data', () => ({
  renderMarkdown: (md: string) => {
    // Simple mock that converts ![alt](src) to <img> tags
    return md.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" />');
  },
}));

describe('parseMarkdownToElements with baseUrl', () => {
  it('passes baseUrl to image elements in markdown content', () => {
    const markdown = '![test image](/media/docs/test.png)';
    const baseUrl = 'https://grafana.com/docs/test/';

    const elements = parseMarkdownToElements(markdown, baseUrl);

    const imgElement = elements.find((el) => el.type === 'image-renderer');
    expect(imgElement).toBeDefined();
    expect(imgElement!.props.baseUrl).toBe(baseUrl);
    expect(imgElement!.props.src).toBe('/media/docs/test.png');
  });

  it('works without baseUrl (backward compatibility)', () => {
    const markdown = '![test image](/media/docs/test.png)';

    const elements = parseMarkdownToElements(markdown);

    const imgElement = elements.find((el) => el.type === 'image-renderer');
    expect(imgElement).toBeDefined();
    expect(imgElement!.props.baseUrl).toBeUndefined();
  });
});

describe('json-parser markdown block with images', () => {
  it('passes baseUrl to images within markdown blocks', () => {
    const guide = JSON.stringify({
      id: 'test-markdown-images',
      title: 'Markdown image test',
      blocks: [
        {
          type: 'markdown',
          content: '![screenshot](/media/docs/screenshot.png)',
        },
      ],
    });
    const baseUrl = 'https://grafana.com/docs/learning-paths/test/';

    const result = parseJsonGuide(guide, baseUrl);

    expect(result.isValid).toBe(true);
    expect(result.data).toBeDefined();

    // Find the image-renderer element within the parsed content
    const findImageElement = (elements: any[]): any => {
      for (const el of elements) {
        if (el.type === 'image-renderer') {
          return el;
        }
        if (el.children && Array.isArray(el.children)) {
          const found = findImageElement(el.children.filter((c: any) => typeof c !== 'string'));
          if (found) {
            return found;
          }
        }
      }
      return null;
    };

    const imgElement = findImageElement(result.data!.elements);
    expect(imgElement).toBeDefined();
    expect(imgElement.props.baseUrl).toBe(baseUrl);
  });

  it('passes baseUrl to images within HTML blocks', () => {
    const guide = JSON.stringify({
      id: 'test-html-images',
      title: 'HTML image test',
      blocks: [
        {
          type: 'html',
          content: '<img src="/media/docs/screenshot.png" alt="screenshot" />',
        },
      ],
    });
    const baseUrl = 'https://grafana.com/docs/learning-paths/test/';

    const result = parseJsonGuide(guide, baseUrl);

    expect(result.isValid).toBe(true);
    expect(result.data).toBeDefined();

    const imgElement = result.data!.elements.find((el) => el.type === 'image-renderer');
    expect(imgElement).toBeDefined();
    expect(imgElement!.props.baseUrl).toBe(baseUrl);
  });

  it('passes baseUrl to JSON image blocks', () => {
    const guide = JSON.stringify({
      id: 'test-json-images',
      title: 'JSON image test',
      blocks: [
        {
          type: 'image',
          src: '/media/docs/screenshot.png',
          alt: 'screenshot',
        },
      ],
    });
    const baseUrl = 'https://grafana.com/docs/learning-paths/test/';

    const result = parseJsonGuide(guide, baseUrl);

    expect(result.isValid).toBe(true);
    expect(result.data).toBeDefined();

    const imgElement = result.data!.elements.find((el) => el.type === 'image-renderer');
    expect(imgElement).toBeDefined();
    expect(imgElement!.props.baseUrl).toBe(baseUrl);
  });
});
