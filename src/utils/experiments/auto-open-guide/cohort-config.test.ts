jest.mock('../../find-doc-page', () => ({
  findDocPage: (guide: string) => (guide === 'bundled:billing' ? { url: guide } : null),
}));

import { isCohortAutoOpenConfig } from './cohort-config';

const experience = { cohort: 'billing', guide: 'bundled:billing', pages: ['/a/grafana-cmab-app*'] };

describe('isCohortAutoOpenConfig', () => {
  it.each(['control', 'treatment'])('accepts %s with a cohort for every experience', (variant) => {
    expect(isCohortAutoOpenConfig({ variant, experiences: [experience] })).toBe(true);
  });

  it('accepts the disabled default without experiences', () => {
    expect(isCohortAutoOpenConfig({ variant: 'excluded' })).toBe(true);
  });

  it.each([undefined, null, '', '  ', 42, ['billing']])('rejects invalid cohort %p', (cohort) => {
    expect(isCohortAutoOpenConfig({ variant: 'treatment', experiences: [{ ...experience, cohort }] })).toBe(false);
  });

  it('rejects the entire payload if one experience is invalid', () => {
    expect(
      isCohortAutoOpenConfig({ variant: 'control', experiences: [experience, { ...experience, cohort: '' }] })
    ).toBe(false);
  });

  it.each([null, [], { variant: 'unknown' }, { variant: 'control', experiences: [] }])(
    'preserves base configuration validation for %p',
    (value) => expect(isCohortAutoOpenConfig(value)).toBe(false)
  );
});
