import { classifyDocsUrl } from '../lib/docs-url-family';
import type { LearningJourneyMetadata } from '../types/content.types';
import {
  LEARN_JOURNEY_MODE_FLAG,
  isLearnJourneyModeEnabled,
  isLearnJourneyModeUrl,
  learnJourneyLocation,
  learnMilestoneUrl,
} from './learn-journey-mode';
import { getFeatureFlagValue } from './openfeature';

jest.mock('./openfeature', () => ({ getFeatureFlagValue: jest.fn() }));

const flag = getFeatureFlagValue as jest.MockedFunction<typeof getFeatureFlagValue>;

const ROOT = 'https://grafana.com/docs/learning-hub';

beforeEach(() => {
  flag.mockReset();
});

describe('isLearnJourneyModeEnabled', () => {
  it('names the registered flag and is off by default', () => {
    flag.mockImplementation((_name, defaultValue) => defaultValue);

    expect(LEARN_JOURNEY_MODE_FLAG).toBe('pathfinder.learn-journey-mode');
    expect(isLearnJourneyModeEnabled()).toBe(false);
    expect(flag).toHaveBeenCalledWith(LEARN_JOURNEY_MODE_FLAG, false);
  });

  it('reads the flag each time, so a value that arrives after startup is honoured', () => {
    flag.mockReturnValueOnce(false).mockReturnValueOnce(true);

    expect(isLearnJourneyModeEnabled()).toBe(false);
    expect(isLearnJourneyModeEnabled()).toBe(true);
  });
});

describe('learnJourneyLocation', () => {
  it.each([
    ['a journey', `${ROOT}/j/`, 'journey'],
    ['a section', `${ROOT}/j/s/`, 'section'],
    ['a step', `${ROOT}/j/s/t/`, 'step'],
    ['a step file', `${ROOT}/j/s/t/unstyled.html`, 'step'],
  ])('reads %s', (_name, url, kind) => {
    expect(learnJourneyLocation(classifyDocsUrl(url))?.kind).toBe(kind);
  });

  it.each([
    ['the home', `${ROOT}/`],
    ['search', `${ROOT}/search/`],
    ['a page deeper than a step', `${ROOT}/j/s/t/extra/`],
    ['a legacy path', 'https://grafana.com/docs/learning-paths/x/'],
    ['a look-alike host', 'https://grafana.com.evil.example/docs/learning-hub/j/'],
    ['an unparseable URL', 'not a url'],
  ])('reads nothing for %s', (_name, url) => {
    expect(learnJourneyLocation(classifyDocsUrl(url))).toBeUndefined();
  });
});

describe('isLearnJourneyModeUrl', () => {
  it('is true for a Learn journey only while the flag is on', () => {
    const classification = classifyDocsUrl(`${ROOT}/j/s/t/`);

    flag.mockReturnValue(true);
    expect(isLearnJourneyModeUrl(classification)).toBe(true);
    flag.mockReturnValue(false);
    expect(isLearnJourneyModeUrl(classification)).toBe(false);
  });

  it('never reads the flag for a URL that is not a Learn journey', () => {
    expect(isLearnJourneyModeUrl(classifyDocsUrl('https://grafana.com/docs/grafana/latest/'))).toBe(false);
    expect(isLearnJourneyModeUrl(classifyDocsUrl(`${ROOT}/`))).toBe(false);
    expect(flag).not.toHaveBeenCalled();
  });
});

describe('learnMilestoneUrl', () => {
  const metadata = (overrides: Partial<LearningJourneyMetadata>): LearningJourneyMetadata => ({
    currentMilestone: 2,
    totalMilestones: 2,
    baseUrl: `${ROOT}/j`,
    milestones: [
      { number: 1, title: 'One', url: `${ROOT}/j/s/one/`, isActive: false },
      { number: 2, title: 'Two', url: `${ROOT}/j/s/two/`, isActive: false },
    ],
    ...overrides,
  });

  it('names the step the current milestone points at', () => {
    expect(learnMilestoneUrl(metadata({}))).toBe(`${ROOT}/j/s/two/`);
  });

  it('names nothing for a cover, missing metadata or a milestone outside the list', () => {
    expect(learnMilestoneUrl(metadata({ currentMilestone: 0 }))).toBeUndefined();
    expect(learnMilestoneUrl(metadata({ currentMilestone: 9 }))).toBeUndefined();
    expect(learnMilestoneUrl(undefined)).toBeUndefined();
    expect(learnMilestoneUrl({ baseUrl: 'bundled:journey' } as LearningJourneyMetadata)).toBeUndefined();
  });

  it('leaves a legacy journey’s URL alone', () => {
    const legacy = metadata({
      milestones: [
        { number: 1, title: 'One', url: 'https://grafana.com/docs/learning-paths/x/milestone-1/', isActive: false },
        { number: 2, title: 'Two', url: 'https://grafana.com/docs/learning-paths/x/milestone-2/', isActive: false },
      ],
    });

    expect(learnMilestoneUrl(legacy)).toBeUndefined();
  });
});
