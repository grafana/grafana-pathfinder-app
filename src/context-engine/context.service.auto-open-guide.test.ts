jest.mock('../utils/find-doc-page', () => ({
  findDocPage: (guide: string) => (guide === 'bundled:x' ? { url: 'bundled:x', title: 'X', type: 'docs-page' } : null),
}));

import { ContextService } from './context.service';
import { setAutoOpenGuideEnrollment } from '../utils/experiments/auto-open-guide/state';
import type { Recommendation } from '../types/context.types';

function rec(overrides: Partial<Recommendation>): Recommendation {
  return { title: 't', url: 'u', ...overrides };
}

const synthetic = { title: 'X', url: 'bundled:x', type: 'docs-page', matchAccuracy: 1, summary: '' };

type InjectFn = (featured: Recommendation[], currentPath: string, bundled: Recommendation[]) => Recommendation[];

const callInject: InjectFn = (featured, currentPath, bundled) =>
  (ContextService as unknown as { injectAutoOpenGuide: InjectFn }).injectAutoOpenGuide(featured, currentPath, bundled);

function enroll(variant: 'control' | 'treatment', guide = 'bundled:x') {
  setAutoOpenGuideEnrollment({ variant, experiences: [{ guide, pages: ['/explore*'] }] });
}

describe('ContextService.injectAutoOpenGuide', () => {
  afterEach(() => {
    setAutoOpenGuideEnrollment(null);
  });

  it('returns featured unchanged before activation', () => {
    const featured = [rec({ url: 'a' })];
    expect(callInject(featured, '/explore', [])).toBe(featured);
  });

  it('returns featured unchanged for the control arm', () => {
    enroll('control');
    const featured = [rec({ url: 'a' })];
    expect(callInject(featured, '/explore', [])).toBe(featured);
  });

  it('returns featured unchanged when the path matches no experience', () => {
    enroll('treatment');
    const featured = [rec({ url: 'a' })];
    expect(callInject(featured, '/dashboards', [])).toBe(featured);
  });

  it('returns featured unchanged when the guide cannot be resolved', () => {
    enroll('treatment', 'bundled:missing');
    const featured = [rec({ url: 'a' })];
    expect(callInject(featured, '/explore', [])).toBe(featured);
  });

  it('prepends the matched guide for the treatment arm', () => {
    enroll('treatment');
    expect(callInject([rec({ url: 'a' })], '/explore/metrics', [])).toEqual([synthetic, rec({ url: 'a' })]);
  });

  it('promotes an existing card for the same URL instead of duplicating it', () => {
    enroll('treatment');
    const existing = rec({ title: 'Existing', url: 'Bundled:X' });
    expect(callInject([rec({ url: 'a' }), existing], '/explore', [])).toEqual([existing, rec({ url: 'a' })]);
  });

  it('does not inject a guide already in the regular recommendations', () => {
    enroll('treatment');
    const featured: Recommendation[] = [];
    expect(callInject(featured, '/explore', [rec({ url: 'BUNDLED:X' })])).toBe(featured);
  });
});
