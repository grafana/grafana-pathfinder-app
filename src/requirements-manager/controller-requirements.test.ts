import {
  GUIDE_SCOPED_REQUIREMENT_PREFIXES,
  splitGuideScopedRequirements,
  stripTabLocalRequirements,
  TAB_LOCAL_REQUIREMENTS,
} from './controller-requirements';

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

describe('splitGuideScopedRequirements (#1574)', () => {
  // Pins the set of storage-backed requirement kinds. A new requirement that
  // reads per-guide storage must be listed here, or the controller would ship
  // it to the live tab and resolve it against that tab's guide identity.
  it('lists exactly the storage-backed requirement prefixes', () => {
    expect([...GUIDE_SCOPED_REQUIREMENT_PREFIXES]).toEqual(['var-']);
  });

  it('keeps var-* on the controller side and round-trips the rest', () => {
    expect(splitGuideScopedRequirements('var-accepted:true, is-admin, exists-reftarget')).toEqual({
      guideScoped: 'var-accepted:true',
      remaining: 'is-admin,exists-reftarget',
    });
  });

  it('leaves remaining empty when every token is storage-backed', () => {
    expect(splitGuideScopedRequirements('var-a:1,var-b:2')).toEqual({
      guideScoped: 'var-a:1,var-b:2',
      remaining: '',
    });
  });

  it('leaves guideScoped empty when no token is storage-backed', () => {
    expect(splitGuideScopedRequirements('is-admin')).toEqual({ guideScoped: '', remaining: 'is-admin' });
  });

  it('treats empty / undefined as no requirements at all', () => {
    expect(splitGuideScopedRequirements(undefined)).toEqual({ guideScoped: '', remaining: '' });
    expect(splitGuideScopedRequirements('')).toEqual({ guideScoped: '', remaining: '' });
  });
});
