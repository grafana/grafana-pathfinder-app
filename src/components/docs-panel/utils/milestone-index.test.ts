import { findCurrentMilestoneIndex } from './milestone-index';

describe('findCurrentMilestoneIndex', () => {
  const milestones = [
    { url: 'https://example.com/journey/step-1' },
    { url: 'https://example.com/journey/step-2' },
    { url: 'https://example.com/journey/step-3' },
  ];

  it('returns 1-indexed position when URL matches', () => {
    expect(findCurrentMilestoneIndex(milestones, 'https://example.com/journey/step-1')).toBe(1);
    expect(findCurrentMilestoneIndex(milestones, 'https://example.com/journey/step-2')).toBe(2);
    expect(findCurrentMilestoneIndex(milestones, 'https://example.com/journey/step-3')).toBe(3);
  });

  it('returns 0 for the cover page (URL not in milestones)', () => {
    expect(findCurrentMilestoneIndex(milestones, 'https://example.com/journey/')).toBe(0);
  });

  it('returns 0 for an empty milestones array', () => {
    expect(findCurrentMilestoneIndex([], 'https://example.com/journey/step-1')).toBe(0);
  });

  it('returns 0 for an empty current URL', () => {
    expect(findCurrentMilestoneIndex(milestones, '')).toBe(0);
  });

  it('does not perform partial matching — full equality required', () => {
    expect(findCurrentMilestoneIndex(milestones, 'https://example.com/journey/step-1#hash')).toBe(0);
    expect(findCurrentMilestoneIndex(milestones, 'https://example.com/journey/step-1?q=1')).toBe(0);
  });
});
