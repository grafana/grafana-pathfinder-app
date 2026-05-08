/**
 * Tests for the auto-recoverable predicate.
 *
 * Important: this set is the contract between editor and runtime. If
 * `isAutoRecoverableRequirement(token)` returns true but the runtime fix
 * registry can't actually fix it, the editor will mislead authors. Pin
 * the tokens explicitly here so adding/removing fix handlers requires
 * thinking about authoring UX too.
 */

import { isAutoRecoverableRequirement } from './auto-recoverable';

describe('isAutoRecoverableRequirement', () => {
  it.each(['exists-reftarget', 'navmenu-open'])('returns true for %s (fixed)', (token) => {
    expect(isAutoRecoverableRequirement(token)).toBe(true);
  });

  it.each(['on-page:/explore', 'on-page:/dashboards', 'on-page:/connections'])(
    'returns true for %s (parameterized)',
    (token) => {
      expect(isAutoRecoverableRequirement(token)).toBe(true);
    }
  );

  it.each([
    'is-admin',
    'has-datasources',
    'has-datasource:prometheus',
    'has-permission:dashboards:write',
    'has-role:editor',
    'min-version:11.0.0',
    'section-completed:setup',
    'has-feature:publicDashboards',
    'in-environment:cloud',
    'var-policyAccepted:true',
    'totally-unknown',
  ])('returns false for non-recoverable token %s', (token) => {
    expect(isAutoRecoverableRequirement(token)).toBe(false);
  });

  it('treats casing strictly (lowercase tokens only)', () => {
    expect(isAutoRecoverableRequirement('Exists-Reftarget')).toBe(false);
    expect(isAutoRecoverableRequirement('ON-PAGE:/x')).toBe(false);
  });
});
