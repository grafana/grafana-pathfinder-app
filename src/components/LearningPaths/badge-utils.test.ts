/**
 * Badge Utilities Tests
 *
 * Behavior-oriented tests for badge progress calculation and requirement text generation.
 */

import { getBadgeProgress, getBadgeRequirementText } from './badge-utils';
import type { Badge } from '../../types';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const createBadge = (trigger: Badge['trigger'], overrides: Partial<Badge> = {}): Badge => ({
  id: 'test-badge',
  title: 'Test Badge',
  description: 'A test badge description',
  icon: 'star',
  trigger,
  ...overrides,
});

const samplePaths = [
  { id: 'getting-started', guides: ['guide-1', 'guide-2', 'guide-3'] },
  { id: 'advanced', guides: ['guide-a', 'guide-b'] },
];

// ============================================================================
// getBadgeProgress
// ============================================================================

describe('getBadgeProgress', () => {
  describe('guide-completed trigger', () => {
    it('returns 100% when specific guide is completed', () => {
      const badge = createBadge({ type: 'guide-completed', guideId: 'guide-1' });

      const result = getBadgeProgress(badge, ['guide-1'], 0, samplePaths);

      expect(result).toEqual({
        current: 1,
        total: 1,
        label: 'guide completed',
        percentage: 100,
      });
    });

    it('returns 0% when specific guide is not completed', () => {
      const badge = createBadge({ type: 'guide-completed', guideId: 'guide-1' });

      const result = getBadgeProgress(badge, ['other-guide'], 0, samplePaths);

      expect(result).toEqual({
        current: 0,
        total: 1,
        label: 'guide completed',
        percentage: 0,
      });
    });

    it('returns 100% when any guide completed (no guideId specified)', () => {
      const badge = createBadge({ type: 'guide-completed' });

      const result = getBadgeProgress(badge, ['any-guide'], 0, samplePaths);

      expect(result).toEqual({
        current: 1,
        total: 1,
        label: 'guide completed',
        percentage: 100,
      });
    });

    it('returns 0% when no guides completed (no guideId specified)', () => {
      const badge = createBadge({ type: 'guide-completed' });

      const result = getBadgeProgress(badge, [], 0, samplePaths);

      expect(result).toEqual({
        current: 0,
        total: 1,
        label: 'guide completed',
        percentage: 0,
      });
    });
  });

  describe('path-completed trigger', () => {
    it('returns null when path not found', () => {
      const badge = createBadge({ type: 'path-completed', pathId: 'non-existent' });

      const result = getBadgeProgress(badge, [], 0, samplePaths);

      expect(result).toBeNull();
    });

    it('returns 0% when no guides in path completed', () => {
      const badge = createBadge({ type: 'path-completed', pathId: 'getting-started' });

      const result = getBadgeProgress(badge, [], 0, samplePaths);

      expect(result).toEqual({
        current: 0,
        total: 3,
        label: 'guides in path',
        percentage: 0,
      });
    });

    it('returns partial progress when some guides completed', () => {
      const badge = createBadge({ type: 'path-completed', pathId: 'getting-started' });

      const result = getBadgeProgress(badge, ['guide-1', 'guide-2'], 0, samplePaths);

      expect(result).toEqual({
        current: 2,
        total: 3,
        label: 'guides in path',
        percentage: 67, // Math.round(2/3 * 100)
      });
    });

    it('returns 100% when all guides in path completed', () => {
      const badge = createBadge({ type: 'path-completed', pathId: 'getting-started' });

      const result = getBadgeProgress(badge, ['guide-1', 'guide-2', 'guide-3'], 0, samplePaths);

      expect(result).toEqual({
        current: 3,
        total: 3,
        label: 'guides in path',
        percentage: 100,
      });
    });
  });

  describe('streak trigger', () => {
    it('returns 0% when streak is 0', () => {
      const badge = createBadge({ type: 'streak', days: 7 });

      const result = getBadgeProgress(badge, [], 0, samplePaths);

      expect(result).toEqual({
        current: 0,
        total: 7,
        label: 'day streak',
        percentage: 0,
      });
    });

    it('returns partial progress for streak in progress', () => {
      const badge = createBadge({ type: 'streak', days: 7 });

      const result = getBadgeProgress(badge, [], 3, samplePaths);

      expect(result).toEqual({
        current: 3,
        total: 7,
        label: 'day streak',
        percentage: 43, // Math.round(3/7 * 100)
      });
    });

    it('returns 100% when streak achieved', () => {
      const badge = createBadge({ type: 'streak', days: 7 });

      const result = getBadgeProgress(badge, [], 7, samplePaths);

      expect(result).toEqual({
        current: 7,
        total: 7,
        label: 'day streak',
        percentage: 100,
      });
    });

    it('caps current at total even if streak exceeds requirement', () => {
      const badge = createBadge({ type: 'streak', days: 7 });

      const result = getBadgeProgress(badge, [], 15, samplePaths);

      expect(result).toEqual({
        current: 7,
        total: 7,
        label: 'day streak',
        percentage: 100,
      });
    });
  });

  describe('unknown trigger type', () => {
    it('returns null for unknown trigger type', () => {
      const badge = createBadge({ type: 'unknown-type' } as Badge['trigger']);

      const result = getBadgeProgress(badge, [], 0, samplePaths);

      expect(result).toBeNull();
    });
  });
});
