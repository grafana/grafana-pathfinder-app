/**
 * Exercises the video-showcase fixture end-to-end through the JSON parser and
 * the native VideoRenderer. The fixture is parsed with a simulated CDN base
 * URL — the way a remote/package guide is fetched — so package-relative asset
 * resolution behaves as it would in production (bundled guides get a synthetic
 * `bundled:` base and cannot resolve local assets; see the PR discussion).
 */

import React from 'react';
import { render } from '@testing-library/react';
import { parseJsonGuide } from './json-parser';
import { VideoRenderer } from './components/docs/video-renderer';
import type { ParsedElement } from '../types/content.types';
import fixture from './__fixtures__/video-showcase.content.json';

jest.mock('@grafana/runtime', () => ({
  config: { bootData: { user: null }, buildInfo: { version: '10.0.0' } },
}));

jest.mock('@grafana/data', () => ({
  renderMarkdown: (md: string) => md,
}));

const BASE_URL = 'https://grafana.com/docs/learning-journeys/video-showcase/content.json';

function parseFixture(): ParsedElement[] {
  const result = parseJsonGuide(JSON.stringify(fixture), BASE_URL);
  expect(result.isValid).toBe(true);
  return result.data!.elements;
}

function findByType(elements: ParsedElement[], type: string): ParsedElement[] {
  const out: ParsedElement[] = [];
  for (const el of elements) {
    if (el.type === type) {
      out.push(el);
    }
    const children = el.children?.filter((c): c is ParsedElement => typeof c !== 'string') ?? [];
    out.push(...findByType(children, type));
  }
  return out;
}

describe('video-showcase fixture', () => {
  it('routes the YouTube block to a youtube-video element', () => {
    const [el] = findByType(parseFixture(), 'youtube-video');
    expect(el?.props.src).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
  });

  it('routes the Vimeo block to a vimeo-video element', () => {
    const [el] = findByType(parseFixture(), 'vimeo-video');
    expect(el?.props.src).toBe('https://vimeo.com/76979871');
  });

  it('keeps a fully-qualified native src untouched and threads baseUrl', () => {
    const natives = findByType(parseFixture(), 'video');
    const absolute = natives.find((el) => el.props.src === 'https://www.w3schools.com/html/mov_bbb.mp4');
    expect(absolute).toBeDefined();
    expect(absolute!.props.baseUrl).toBe(BASE_URL);
  });

  it('resolves a package-relative native src against the guide base URL when rendered', () => {
    const natives = findByType(parseFixture(), 'video');
    const relative = natives.find((el) => el.props.src === 'assets/rickroll-clip.mp4');
    expect(relative).toBeDefined();
    expect(relative!.props.baseUrl).toBe(BASE_URL);

    const { container } = render(<VideoRenderer src={relative!.props.src} baseUrl={relative!.props.baseUrl} />);
    expect(container.querySelector('video')).toHaveAttribute(
      'src',
      'https://grafana.com/docs/learning-journeys/video-showcase/assets/rickroll-clip.mp4'
    );
  });
});
