import { stripTabLocalRequirements } from './controller-requirements';

describe('stripTabLocalRequirements', () => {
  it('drops requirements that probe this tab (DOM / URL / nav)', () => {
    expect(stripTabLocalRequirements('exists-reftarget')).toBe('');
    expect(stripTabLocalRequirements('navmenu-open')).toBe('');
    expect(stripTabLocalRequirements('on-page:/explore')).toBe('');
    expect(stripTabLocalRequirements('form-valid')).toBe('');
  });

  it('keeps session / permission requirements so genuine failures still surface', () => {
    expect(stripTabLocalRequirements('is-admin')).toBe('is-admin');
    expect(stripTabLocalRequirements('has-datasources')).toBe('has-datasources');
    expect(stripTabLocalRequirements('has-datasource:prometheus')).toBe('has-datasource:prometheus');
    expect(stripTabLocalRequirements('dashboard-exists')).toBe('dashboard-exists');
    expect(stripTabLocalRequirements('section-completed:intro')).toBe('section-completed:intro');
  });

  it('keeps only the session requirements from a mixed list', () => {
    expect(stripTabLocalRequirements('exists-reftarget, is-admin, on-page:/explore, has-datasources')).toBe(
      'is-admin,has-datasources'
    );
  });

  it('passes empty / undefined through unchanged', () => {
    expect(stripTabLocalRequirements(undefined)).toBeUndefined();
    expect(stripTabLocalRequirements('')).toBe('');
  });
});
