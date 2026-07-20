/**
 * Tests for video block routing in the JSON parser: provider detection and
 * baseUrl threading for self-hosted native video.
 */

import { parseJsonGuide } from './json-parser';

jest.mock('@grafana/runtime', () => ({
  config: { bootData: { user: null }, buildInfo: { version: '10.0.0' } },
}));

jest.mock('@grafana/data', () => ({
  renderMarkdown: (md: string) => md,
}));

function firstElement(guideBlocks: unknown[], baseUrl?: string) {
  const guide = JSON.stringify({ id: 'video-routing', title: 'Video routing', blocks: guideBlocks });
  const result = parseJsonGuide(guide, baseUrl);
  expect(result.isValid).toBe(true);
  const el = result.data!.elements[0];
  if (!el) {
    throw new Error('no element parsed');
  }
  return el;
}

describe('json-parser video routing', () => {
  it('routes an explicit youtube provider to the youtube-video element', () => {
    const el = firstElement([{ type: 'video', provider: 'youtube', src: 'https://www.youtube.com/embed/abc123' }]);
    expect(el.type).toBe('youtube-video');
  });

  it('routes a bare youtube URL to the youtube-video element', () => {
    const el = firstElement([{ type: 'video', src: 'https://youtu.be/abc123' }]);
    expect(el.type).toBe('youtube-video');
  });

  it('routes an explicit vimeo provider to the vimeo-video element', () => {
    const el = firstElement([{ type: 'video', provider: 'vimeo', src: 'https://player.vimeo.com/video/76979871' }]);
    expect(el.type).toBe('vimeo-video');
  });

  it('routes a bare vimeo URL to the vimeo-video element', () => {
    const el = firstElement([{ type: 'video', src: 'https://vimeo.com/76979871' }]);
    expect(el.type).toBe('vimeo-video');
  });

  it('routes a native provider to the video element and threads baseUrl', () => {
    const baseUrl = 'https://cdn.example.com/pkg/content.json';
    const el = firstElement([{ type: 'video', provider: 'native', src: 'assets/demo.mp4' }], baseUrl);
    expect(el.type).toBe('video');
    expect(el.props.src).toBe('assets/demo.mp4');
    expect(el.props.baseUrl).toBe(baseUrl);
  });

  it('defaults a non-provider mp4 URL to the native video element', () => {
    const el = firstElement([{ type: 'video', src: 'https://cdn.example.com/video.mp4' }]);
    expect(el.type).toBe('video');
  });
});
