import { deriveStepId } from './step-id';

describe('deriveStepId', () => {
  it('is deterministic for identical inputs', () => {
    const a = deriveStepId({
      sectionId: 'section-explore',
      index: 0,
      action: 'highlight',
      refTarget: 'a[href="/explore"]',
    });
    const b = deriveStepId({
      sectionId: 'section-explore',
      index: 0,
      action: 'highlight',
      refTarget: 'a[href="/explore"]',
    });
    expect(a).toBe(b);
  });

  it('changes when the index changes', () => {
    const a = deriveStepId({ sectionId: 'section-x', index: 0, action: 'highlight' });
    const b = deriveStepId({ sectionId: 'section-x', index: 1, action: 'highlight' });
    expect(a).not.toBe(b);
  });

  it('changes when the action changes', () => {
    const a = deriveStepId({ sectionId: 'section-x', index: 0, action: 'highlight' });
    const b = deriveStepId({ sectionId: 'section-x', index: 0, action: 'button' });
    expect(a).not.toBe(b);
  });

  it('changes when the refTarget changes', () => {
    const a = deriveStepId({ sectionId: 'section-x', index: 0, refTarget: 'a' });
    const b = deriveStepId({ sectionId: 'section-x', index: 0, refTarget: 'b' });
    expect(a).not.toBe(b);
  });

  it('changes when the variant disambiguator changes', () => {
    const a = deriveStepId({ sectionId: 'section-x', index: 0, variant: 'sub-0' });
    const b = deriveStepId({ sectionId: 'section-x', index: 0, variant: 'sub-1' });
    expect(a).not.toBe(b);
  });

  it('treats missing optional fields as empty strings consistently', () => {
    const a = deriveStepId({ sectionId: 'section-x', index: 0 });
    const b = deriveStepId({ sectionId: 'section-x', index: 0, action: undefined, refTarget: undefined });
    expect(a).toBe(b);
  });

  it('produces IDs that begin with the section ID prefix for debug-readability', () => {
    const id = deriveStepId({ sectionId: 'section-explore-tutorial', index: 2, action: 'highlight' });
    expect(id.startsWith('section-explore-tutorial-step-')).toBe(true);
  });

  it('produces lowercase base-36 hash suffix', () => {
    const id = deriveStepId({ sectionId: 'section-x', index: 0, action: 'highlight' });
    const suffix = id.replace(/^section-x-step-/, '');
    expect(suffix).toMatch(/^[0-9a-z]+$/);
  });
});
