/**
 * Tests for ContextService.injectHighlightedGuide
 *
 * The injection helper is private in TypeScript; we exercise it through the
 * class object directly. Mocks isolate it from the recommender pipeline so
 * we test only the prepend / dedup / page-gate logic.
 */

jest.mock('../utils/openfeature', () => ({
  getHighlightedGuideConfig: jest.fn(),
}));

jest.mock('../utils/experiments', () => ({
  buildSyntheticFeaturedRecommendation: jest.fn(),
  matchesHighlightedGuidePage: jest.fn(
    (pages: string[], path: string) =>
      Array.isArray(pages) && pages.some((p) => (p.endsWith('*') ? path.startsWith(p.slice(0, -1)) : p === path))
  ),
}));

import { ContextService } from './context.service';
import { getHighlightedGuideConfig } from '../utils/openfeature';
import { buildSyntheticFeaturedRecommendation } from '../utils/experiments';
import type { Recommendation } from '../types/context.types';

const mockGetConfig = getHighlightedGuideConfig as jest.Mock;
const mockBuildSynthetic = buildSyntheticFeaturedRecommendation as jest.Mock;

function rec(overrides: Partial<Recommendation>): Recommendation {
  return { title: 't', url: 'u', ...overrides };
}

type InjectFn = (featured: Recommendation[], currentPath: string, bundled: Recommendation[]) => Recommendation[];

const callInject: InjectFn = (featured, currentPath, bundled) =>
  (ContextService as unknown as { injectHighlightedGuide: InjectFn }).injectHighlightedGuide(
    featured,
    currentPath,
    bundled
  );

describe('ContextService.injectHighlightedGuide', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns featured unchanged when variant is excluded', () => {
    mockGetConfig.mockReturnValue({ variant: 'excluded', pages: ['/explore'], guideId: 'bundled:x' });
    const featured = [rec({ url: 'a' })];
    expect(callInject(featured, '/explore', [])).toBe(featured);
    expect(mockBuildSynthetic).not.toHaveBeenCalled();
  });

  it('returns featured unchanged when path does not match', () => {
    mockGetConfig.mockReturnValue({ variant: 'treatment', pages: ['/explore'], guideId: 'bundled:x' });
    const featured = [rec({ url: 'a' })];
    expect(callInject(featured, '/dashboards', [])).toBe(featured);
    expect(mockBuildSynthetic).not.toHaveBeenCalled();
  });

  it('returns featured unchanged when guide cannot be resolved', () => {
    mockGetConfig.mockReturnValue({ variant: 'treatment', pages: ['/explore'], guideId: 'bundled:bad' });
    mockBuildSynthetic.mockReturnValue(null);
    const featured = [rec({ url: 'a' })];
    expect(callInject(featured, '/explore', [])).toBe(featured);
  });

  it('prepends the synthetic when treatment + match + valid guide + no dup', () => {
    mockGetConfig.mockReturnValue({ variant: 'treatment', pages: ['/explore'], guideId: 'bundled:x' });
    const synthetic = rec({ title: 'X', url: 'bundled:x', type: 'docs-page', matchAccuracy: 1, summary: '' });
    mockBuildSynthetic.mockReturnValue(synthetic);
    const featured = [rec({ url: 'a' })];
    expect(callInject(featured, '/explore', [])).toEqual([synthetic, rec({ url: 'a' })]);
  });

  it('also injects under variant = control (both arms inject)', () => {
    mockGetConfig.mockReturnValue({ variant: 'control', pages: ['/explore'], guideId: 'bundled:x' });
    const synthetic = rec({ url: 'bundled:x' });
    mockBuildSynthetic.mockReturnValue(synthetic);
    expect(callInject([], '/explore', [])).toEqual([synthetic]);
  });

  it('promotes the existing card to position 0 when the same URL is already in featured (no duplicate)', () => {
    mockGetConfig.mockReturnValue({ variant: 'treatment', pages: ['/explore'], guideId: 'bundled:x' });
    mockBuildSynthetic.mockReturnValue(rec({ url: 'bundled:x' }));
    const existing = rec({ title: 'Existing', url: 'bundled:x' });
    const featured = [rec({ url: 'a' }), existing, rec({ url: 'b' })];
    const result = callInject(featured, '/explore', []);
    expect(result).toEqual([existing, rec({ url: 'a' }), rec({ url: 'b' })]);
  });

  it('does NOT inject when the same guide is already in bundled (dedup machinery would suppress it)', () => {
    mockGetConfig.mockReturnValue({ variant: 'treatment', pages: ['/explore'], guideId: 'bundled:x' });
    mockBuildSynthetic.mockReturnValue(rec({ url: 'bundled:x' }));
    const featured: Recommendation[] = [];
    const bundled = [rec({ url: 'BUNDLED:X' })];
    expect(callInject(featured, '/explore', bundled)).toBe(featured);
  });

  it('matches URLs case-insensitively for the dedup check', () => {
    mockGetConfig.mockReturnValue({ variant: 'treatment', pages: ['/explore'], guideId: 'API:foo' });
    mockBuildSynthetic.mockReturnValue(rec({ url: 'backend-guide:foo' }));
    const existing = rec({ url: 'Backend-Guide:foo' });
    const result = callInject([existing, rec({ url: 'other' })], '/explore', []);
    expect(result[0]).toBe(existing);
    expect(result).toHaveLength(2);
  });

  it('passes config.docType through to the synthetic builder for type overrides', () => {
    mockGetConfig.mockReturnValue({
      variant: 'treatment',
      pages: ['/explore'],
      guideId: 'https://grafana.com/docs/learning-paths/foo/',
      docType: 'learning-journey',
    });
    mockBuildSynthetic.mockReturnValue(rec({ url: 'https://grafana.com/docs/learning-paths/foo/' }));
    callInject([], '/explore', []);
    expect(mockBuildSynthetic).toHaveBeenCalledWith('https://grafana.com/docs/learning-paths/foo/', 'learning-journey');
  });
});
