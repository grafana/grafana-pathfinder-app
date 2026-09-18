import { combineCheckVerdicts } from './check-verdict';

it('does not treat a permissive legacy boolean as verified evidence', () => {
  expect(combineCheckVerdicts([{ pass: true, verdict: 'invalid' }, { pass: true }])).toBe('invalid');
});
it('distinguishes incomplete evaluations from a negative result', () => {
  expect(combineCheckVerdicts([{ pass: false, verdict: 'unavailable' }, { pass: false }])).toBe('unavailable');
  expect(combineCheckVerdicts([{ pass: false }])).toBe('unsatisfied');
  expect(combineCheckVerdicts([{ pass: true }])).toBe('satisfied');
});
