import { reportInteraction } from '@grafana/runtime';

import { AnalyticsContentType, AnalyticsLinkType, UserInteraction, reportAppInteraction } from './analytics';
import { toAnalyticsValue } from './analytics-values';
import {
  checkValueCasing,
  drainValueCasingViolations,
  findKebabCaseValues,
  isExemptAnalyticsProperty,
} from './analytics-value-check';

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  reportInteraction: jest.fn(),
  config: { buildInfo: { version: '12.0.0' }, bootData: { user: {} } },
}));

const SNAKE_CASE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

describe('toAnalyticsValue', () => {
  it.each([
    ['learning-hub', 'learning_hub'],
    ['guide-completed', 'guide_completed'],
    ['path-completed', 'path_completed'],
    ['interactive-tutorials', 'interactive_tutorials'],
    ['code-block', 'code_block'],
    ['checkbox-group', 'checkbox_group'],
    ['already_snake', 'already_snake'],
    ['single', 'single'],
  ])('maps %s to %s', (domain, analytics) => {
    expect(toAnalyticsValue(domain)).toBe(analytics);
  });
});

describe('findKebabCaseValues', () => {
  it('reports kebab-case values on enum-like properties', () => {
    expect(findKebabCaseValues({ content_type: 'interactive-guide', action: 'close_sidebar' })).toEqual([
      'content_type=interactive-guide',
    ]);
  });

  it('ignores identifiers, titles and URLs, which are not a fixed vocabulary', () => {
    expect(
      findKebabCaseValues({
        guide_id: 'first-steps',
        badge_title: 'my-title',
        content_url: 'my-url',
        ref_target: 'save-button',
        guide_title: 'a-b',
      })
    ).toEqual([]);
  });

  it('ignores numbers, booleans, sentences and snake_case values', () => {
    expect(
      findKebabCaseValues({ count: 1, flag: true, reason: 'not a kebab-case value', source: 'url_param' })
    ).toEqual([]);
  });

  it('exempts only by property name', () => {
    expect(isExemptAnalyticsProperty('guide_id')).toBe(true);
    expect(isExemptAnalyticsProperty('content_type')).toBe(false);
    expect(isExemptAnalyticsProperty('guide_source')).toBe(false);
    expect(isExemptAnalyticsProperty('source')).toBe(true);
    expect(isExemptAnalyticsProperty('launch_source')).toBe(true);
  });
});

describe('reportAppInteraction value casing', () => {
  beforeEach(() => {
    drainValueCasingViolations();
  });

  it('records a kebab-case value without changing what is reported', () => {
    reportAppInteraction(UserInteraction.DocsPanelInteraction, { action: 'auto-open' });

    expect(drainValueCasingViolations()).toEqual(['pathfinder_docs_panel_interaction: action=auto-open']);
    expect(reportInteraction).toHaveBeenCalledWith(
      'pathfinder_docs_panel_interaction',
      expect.objectContaining({ action: 'auto-open' })
    );
  });

  it('records nothing for snake_case values', () => {
    reportAppInteraction(UserInteraction.DocsPanelInteraction, { action: 'auto_open', source: 'learning_hub' });

    expect(drainValueCasingViolations()).toEqual([]);
  });
});

describe('checkValueCasing in production', () => {
  const original = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = original;
    drainValueCasingViolations();
  });

  it('is a no-op: records nothing and logs nothing', () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    process.env.NODE_ENV = 'production';

    checkValueCasing('pathfinder_docs_panel_interaction', { action: 'auto-open' });

    expect(drainValueCasingViolations()).toEqual([]);
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });
});

describe('analytics vocabularies', () => {
  it.each([
    ['UserInteraction', Object.values(UserInteraction)],
    ['AnalyticsContentType', Object.values(AnalyticsContentType)],
    ['AnalyticsLinkType', Object.values(AnalyticsLinkType)],
  ])('%s values are snake_case', (_name, values) => {
    expect(values.filter((value) => !SNAKE_CASE.test(value))).toEqual([]);
  });
});
