import {
  collectDomContext,
  describeElement,
  isNavPollution,
  isPathfinderInternal,
  scoreCandidate,
  tagFromSelector,
  tokensFromSelector,
} from './ai-fix-dom-context';

describe('tokensFromSelector', () => {
  it('extracts quoted attribute values and their words', () => {
    expect(tokensFromSelector('[data-testid="run query button"]')).toEqual(
      expect.arrayContaining(['run query button', 'run', 'query', 'button'])
    );
  });

  it('falls back to bare class/id tokens when no quoted strings are present', () => {
    expect(tokensFromSelector('#var-filters .panel-content')).toEqual(
      expect.arrayContaining(['var-filters', 'panel-content'])
    );
  });
});

describe('tagFromSelector', () => {
  it('returns the leading tag name', () => {
    expect(tagFromSelector('button[data-testid="x"]')).toBe('button');
  });

  it('returns undefined for attribute/class/prefixed selectors', () => {
    expect(tagFromSelector('[data-testid="x"]')).toBeUndefined();
    expect(tagFromSelector('.foo')).toBeUndefined();
    expect(tagFromSelector('grafana:components.PanelEditor.General')).toBeUndefined();
  });
});

describe('isNavPollution', () => {
  it('flags nav menu items, bookmarks, and svgs; passes real content', () => {
    document.body.innerHTML = `
      <a data-testid="data-testid Nav menu item">Nav</a>
      <button aria-label="Bookmark Dashboards">b</button>
      <div data-testid="real-thing">ok</div>`;
    expect(isNavPollution(document.querySelector('[data-testid="data-testid Nav menu item"]')!)).toBe(true);
    expect(isNavPollution(document.querySelector('[aria-label="Bookmark Dashboards"]')!)).toBe(true);
    expect(isNavPollution(document.querySelector('[data-testid="real-thing"]')!)).toBe(false);
  });
});

describe('isPathfinderInternal', () => {
  it('flags elements inside the docs-panel content root, passes live-surface elements', () => {
    document.body.innerHTML = `
      <div data-pathfinder-content="true"><button data-testid="inside">x</button></div>
      <button data-testid="outside">y</button>`;
    expect(isPathfinderInternal(document.querySelector('[data-testid="inside"]')!)).toBe(true);
    expect(isPathfinderInternal(document.querySelector('[data-testid="outside"]')!)).toBe(false);
  });
});

describe('describeElement', () => {
  it('formats tag, text and identifying attributes', () => {
    document.body.innerHTML = '<button data-testid="run" aria-label="Run query">Run</button>';
    expect(describeElement(document.querySelector('button')!)).toBe(
      '<button> "Run" [data-testid="run", aria-label="Run query"]'
    );
  });

  it('returns null when an element has no text or identifying attributes', () => {
    document.body.innerHTML = '<div></div>';
    expect(describeElement(document.querySelector('div')!)).toBeNull();
  });
});

describe('scoreCandidate', () => {
  it('scores token overlap plus a data-testid bonus', () => {
    document.body.innerHTML = '<button data-testid="run-query">Run</button>';
    expect(scoreCandidate(document.querySelector('button')!, ['run'])).toBe(6);
  });
});

describe('collectDomContext', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('surfaces near-matches and headings, filters nav + pathfinder-internal elements', () => {
    document.body.innerHTML = `
      <h1>Dashboards</h1>
      <a data-testid="data-testid Nav menu item">Nav</a>
      <div data-pathfinder-content="true"><button data-testid="search-services">internal</button></div>
      <button data-testid="search-services-real" aria-label="Search services">Search</button>`;
    const ctx = collectDomContext('[data-testid="search-services"]');
    expect(ctx).toContain('Headings: Dashboards');
    expect(ctx).toContain('search-services-real');
    expect(ctx).not.toContain('Nav menu item');
  });

  it('reports a no-matches note when nothing fuzzy-matches the failing selector', () => {
    document.body.innerHTML = '<button data-testid="totally-unrelated">x</button>';
    const ctx = collectDomContext('[data-testid="zzz-nonexistent"]');
    expect(ctx).toContain('(none — failing tokens not found)');
  });
});
