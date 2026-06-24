import { stripTabLocalRequirements, TAB_LOCAL_REQUIREMENTS } from './controller-requirements';

describe('TAB_LOCAL_REQUIREMENTS drift guard (F-1063-2)', () => {
  // Pins the allowlist of tab-local (DOM/URL/nav-probing) requirement kinds.
  // If a new such requirement is added to the requirements checker, this list
  // must grow to match — otherwise it would be evaluated against the controller
  // tab instead of stripped. Update both together; this test is the reminder.
  it('contains exactly the known DOM/URL/navigation-probing requirements', () => {
    expect([...TAB_LOCAL_REQUIREMENTS].sort()).toEqual(
      ['exists-reftarget', 'form-valid', 'navmenu-open', 'on-page'].sort()
    );
  });

  it('strips every listed requirement (bare and parameterized forms)', () => {
    for (const id of TAB_LOCAL_REQUIREMENTS) {
      expect(stripTabLocalRequirements(id)).toBe('');
      expect(stripTabLocalRequirements(`${id}:some-arg`)).toBe('');
    }
  });
});

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
