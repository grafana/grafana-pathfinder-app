import { renderHook } from '@testing-library/react';
import { useDocumentOutline } from './useDocumentOutline';

function containerWith(html: string): React.RefObject<HTMLDivElement> {
  const div = document.createElement('div');
  div.innerHTML = html;
  return { current: div };
}

describe('useDocumentOutline', () => {
  it('returns [] when the container has fewer than 2 headings', () => {
    const containerRef = containerWith('<h2>Only one</h2>');
    const { result } = renderHook(() => useDocumentOutline(containerRef, 'doc-1', true));
    expect(result.current).toEqual([]);
  });

  it('returns [] when not ready', () => {
    const containerRef = containerWith('<h2>One</h2><h2>Two</h2>');
    const { result } = renderHook(() => useDocumentOutline(containerRef, 'doc-1', false));
    expect(result.current).toEqual([]);
  });

  it('extracts HTML-doc headings in order, preserving existing ids and generating missing ones', () => {
    const containerRef = containerWith(`
      <h2 id="already-set">Introduction</h2>
      <p>Some text</p>
      <h3>Getting started</h3>
      <h2>Advanced usage</h2>
    `);
    const { result } = renderHook(() => useDocumentOutline(containerRef, 'doc-1', true));

    expect(result.current).toEqual([
      { id: 'already-set', text: 'Introduction', level: 2, kind: 'heading' },
      { id: 'getting-started', text: 'Getting started', level: 3, kind: 'heading' },
      { id: 'advanced-usage', text: 'Advanced usage', level: 2, kind: 'heading' },
    ]);

    // ids are written onto the actual DOM elements, not just returned
    expect(containerRef.current!.querySelector('h3')!.id).toBe('getting-started');
  });

  it('extracts interactive-guide sections using their existing id and title text', () => {
    const containerRef = containerWith(`
      <div data-interactive-section="true" id="section-1">
        <span class="interactive-section-title">Explore your data</span>
      </div>
      <div data-interactive-section="true" id="section-2">
        <span class="interactive-section-title">Create a dashboard</span>
      </div>
    `);
    const { result } = renderHook(() => useDocumentOutline(containerRef, 'doc-1', true));

    expect(result.current).toEqual([
      { id: 'section-1', text: 'Explore your data', level: 2, kind: 'section' },
      { id: 'section-2', text: 'Create a dashboard', level: 2, kind: 'section' },
    ]);
  });

  it('collapses a lead-in heading into the section that repeats its title', () => {
    // Mirrors bundled-interactives/first-dashboard: a markdown heading immediately
    // followed by an interactive section sharing the same title text.
    const containerRef = containerWith(`
      <h2>Explore your data</h2>
      <p>Before building a dashboard, explore your data.</p>
      <div data-interactive-section="true" id="section-explore-tutorial">
        <span class="interactive-section-title">Explore your data</span>
      </div>
      <h2>Create a dashboard</h2>
      <div data-interactive-section="true" id="section-dashboard">
        <span class="interactive-section-title">Create a dashboard</span>
      </div>
    `);
    const { result } = renderHook(() => useDocumentOutline(containerRef, 'doc-1', true));

    expect(result.current).toEqual([
      { id: 'section-explore-tutorial', text: 'Explore your data', level: 2, kind: 'section' },
      { id: 'section-dashboard', text: 'Create a dashboard', level: 2, kind: 'section' },
    ]);
  });

  it('does not collapse a heading into an unrelated following section', () => {
    const containerRef = containerWith(`
      <h2>Overview</h2>
      <div data-interactive-section="true" id="section-1">
        <span class="interactive-section-title">Step one</span>
      </div>
    `);
    const { result } = renderHook(() => useDocumentOutline(containerRef, 'doc-1', true));

    expect(result.current).toEqual([
      { id: 'overview', text: 'Overview', level: 2, kind: 'heading' },
      { id: 'section-1', text: 'Step one', level: 2, kind: 'section' },
    ]);
  });

  it('keeps ids stable across re-runs with the same content key', () => {
    const containerRef = containerWith('<h2>First</h2><h2>Second</h2>');
    const { result, rerender } = renderHook(({ key }) => useDocumentOutline(containerRef, key, true), {
      initialProps: { key: 'doc-1' },
    });

    const firstRun = result.current;
    rerender({ key: 'doc-1-again' });

    expect(result.current).toEqual(firstRun);
  });

  it('re-extracts when the content key changes after the DOM is swapped', () => {
    const containerRef = containerWith('<h2>First</h2><h2>Second</h2>');
    const { result, rerender } = renderHook(({ key }) => useDocumentOutline(containerRef, key, true), {
      initialProps: { key: 'doc-1' },
    });

    expect(result.current).toHaveLength(2);

    containerRef.current!.innerHTML = '<h2>New heading</h2><h2>Another new heading</h2><h2>Third</h2>';
    rerender({ key: 'doc-2' });

    expect(result.current).toEqual([
      { id: 'new-heading', text: 'New heading', level: 2, kind: 'heading' },
      { id: 'another-new-heading', text: 'Another new heading', level: 2, kind: 'heading' },
      { id: 'third', text: 'Third', level: 2, kind: 'heading' },
    ]);
  });
});
