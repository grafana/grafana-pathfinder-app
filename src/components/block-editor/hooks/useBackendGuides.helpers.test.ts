import { hasManageableBackendGuides } from './useBackendGuides';

type State = Parameters<typeof hasManageableBackendGuides>[0];

const guide = { metadata: { name: 'g', namespace: 'ns' }, spec: { id: 'g', title: 'g', blocks: [] } } as any;

function state(overrides: Partial<State>): State {
  return { guides: [], error: null, hasLoaded: false, ...overrides };
}

describe('hasManageableBackendGuides', () => {
  it('stays visible while the initial fetch is still loading (not yet resolved)', () => {
    expect(hasManageableBackendGuides(state({ hasLoaded: false, guides: [] }))).toBe(true);
  });

  it('stays visible after a failed fetch so the entry is not stuck hidden', () => {
    expect(hasManageableBackendGuides(state({ hasLoaded: true, error: 'boom', guides: [] }))).toBe(true);
  });

  it('hides once an initial fetch has confirmed an empty list', () => {
    expect(hasManageableBackendGuides(state({ hasLoaded: true, error: null, guides: [] }))).toBe(false);
  });

  it('shows when the resolved list has guides', () => {
    expect(hasManageableBackendGuides(state({ hasLoaded: true, error: null, guides: [guide] }))).toBe(true);
  });

  it('transitions from visible (loading) to hidden (resolved empty)', () => {
    expect(hasManageableBackendGuides(state({ hasLoaded: false, guides: [] }))).toBe(true);
    expect(hasManageableBackendGuides(state({ hasLoaded: true, error: null, guides: [] }))).toBe(false);
  });
});
