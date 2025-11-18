/**
 * Tests for element inspector hook
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useElementInspector, generateFullDomPath } from './element-inspector.hook';

describe('generateFullDomPath', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('generates path with tag, classes, and id', () => {
    const div = document.createElement('div');
    div.id = 'test-id';
    div.className = 'class-one class-two';
    document.body.appendChild(div);

    const path = generateFullDomPath(div);
    expect(path).toContain('div#test-id.class-one.class-two');
  });

  it('includes runtime-generated classes', () => {
    const button = document.createElement('button');
    button.className = 'btn css-abc123 emotion-xyz';
    document.body.appendChild(button);

    const path = generateFullDomPath(button);
    expect(path).toContain('.css-abc123');
    expect(path).toContain('.emotion-xyz');
  });

  it('includes data-testid attributes', () => {
    const button = document.createElement('button');
    button.setAttribute('data-testid', 'save-button');
    document.body.appendChild(button);

    const path = generateFullDomPath(button);
    expect(path).toContain('[data-testid="save-button"]');
  });

  it('includes aria-label attributes', () => {
    const button = document.createElement('button');
    button.setAttribute('aria-label', 'Close dialog');
    document.body.appendChild(button);

    const path = generateFullDomPath(button);
    expect(path).toContain('[aria-label="Close dialog"]');
  });

  it('generates full path from body to element', () => {
    const container = document.createElement('div');
    container.className = 'container';
    const main = document.createElement('main');
    main.id = 'content';
    const button = document.createElement('button');
    button.className = 'btn';

    document.body.appendChild(container);
    container.appendChild(main);
    main.appendChild(button);

    const path = generateFullDomPath(button);
    expect(path).toContain('div.container');
    expect(path).toContain('main#content');
    expect(path).toContain('button.btn');
    expect(path).toMatch(/div\.container.*>.*main#content.*>.*button\.btn/);
  });

  it('handles elements with no classes or ids', () => {
    const span = document.createElement('span');
    document.body.appendChild(span);

    const path = generateFullDomPath(span);
    expect(path).toContain('span');
    expect(path).not.toContain('#');
    expect(path).not.toContain('.');
  });
});

describe('useElementInspector', () => {
  beforeEach(() => {
    document.body.innerHTML = '';

    // Ensure elementFromPoint exists in jsdom
    if (!document.elementFromPoint) {
      document.elementFromPoint = jest.fn();
    }
  });

  afterEach(() => {
    // Clean up any highlights
    const highlight = document.getElementById('dev-tools-hover-highlight');
    if (highlight) {
      highlight.remove();
    }
  });

  it('returns null values when inactive', () => {
    const { result } = renderHook(() =>
      useElementInspector({
        isActive: false,
      })
    );

    expect(result.current.hoveredElement).toBeNull();
    expect(result.current.domPath).toBeNull();
    expect(result.current.cursorPosition).toBeNull();
  });

  it('activates when isActive is true', async () => {
    const button = document.createElement('button');
    button.setAttribute('data-testid', 'test-button');
    document.body.appendChild(button);

    // Mock elementFromPoint to return our button
    const elementFromPointSpy = jest.spyOn(document, 'elementFromPoint').mockReturnValue(button);

    const { result } = renderHook(() =>
      useElementInspector({
        isActive: true,
      })
    );

    // Simulate mousemove
    act(() => {
      const event = new MouseEvent('mousemove', {
        clientX: 10,
        clientY: 10,
        bubbles: true,
      });
      document.dispatchEvent(event);
    });

    await waitFor(() => {
      expect(result.current.hoveredElement).toBe(button);
    });

    expect(result.current.domPath).toContain('button');
    expect(result.current.domPath).toContain('[data-testid="test-button"]');
    expect(result.current.cursorPosition).toEqual({ x: 10, y: 10 });

    elementFromPointSpy.mockRestore();
  });

  it('respects excludeSelectors', async () => {
    const debugPanel = document.createElement('div');
    debugPanel.className = 'debug-panel';
    document.body.appendChild(debugPanel);

    const elementFromPointSpy = jest.spyOn(document, 'elementFromPoint').mockReturnValue(debugPanel);

    const { result } = renderHook(() =>
      useElementInspector({
        isActive: true,
        excludeSelectors: ['.debug-panel'],
      })
    );

    act(() => {
      const event = new MouseEvent('mousemove', {
        clientX: 10,
        clientY: 10,
        bubbles: true,
      });
      document.dispatchEvent(event);
    });

    await waitFor(() => {
      expect(result.current.hoveredElement).toBeNull();
    });

    elementFromPointSpy.mockRestore();
  });

  it('calls onHover callback with element and path', async () => {
    const button = document.createElement('button');
    button.setAttribute('data-testid', 'test-button');
    document.body.appendChild(button);

    const elementFromPointSpy = jest.spyOn(document, 'elementFromPoint').mockReturnValue(button);
    const onHover = jest.fn();

    renderHook(() =>
      useElementInspector({
        isActive: true,
        onHover,
      })
    );

    act(() => {
      const event = new MouseEvent('mousemove', {
        clientX: 10,
        clientY: 10,
        bubbles: true,
      });
      document.dispatchEvent(event);
    });

    await waitFor(() => {
      expect(onHover).toHaveBeenCalled();
    });

    expect(onHover).toHaveBeenCalledWith(button, expect.stringContaining('button'));

    elementFromPointSpy.mockRestore();
  });

  it('cleans up on unmount', async () => {
    const button = document.createElement('button');
    document.body.appendChild(button);

    const elementFromPointSpy = jest.spyOn(document, 'elementFromPoint').mockReturnValue(button);

    const { unmount } = renderHook(() =>
      useElementInspector({
        isActive: true,
      })
    );

    act(() => {
      const event = new MouseEvent('mousemove', {
        clientX: 10,
        clientY: 10,
        bubbles: true,
      });
      document.dispatchEvent(event);
    });

    // Create highlight
    await waitFor(() => {
      const highlight = document.getElementById('dev-tools-hover-highlight');
      expect(highlight).toBeInTheDocument();
    });

    // Unmount should clean up
    unmount();

    await waitFor(() => {
      const highlight = document.getElementById('dev-tools-hover-highlight');
      expect(highlight).not.toBeInTheDocument();
    });

    elementFromPointSpy.mockRestore();
  });

  it('cleans up when deactivated', async () => {
    const button = document.createElement('button');
    document.body.appendChild(button);

    const elementFromPointSpy = jest.spyOn(document, 'elementFromPoint').mockReturnValue(button);

    const { rerender } = renderHook(({ isActive }) => useElementInspector({ isActive }), {
      initialProps: { isActive: true },
    });

    act(() => {
      const event = new MouseEvent('mousemove', {
        clientX: 10,
        clientY: 10,
        bubbles: true,
      });
      document.dispatchEvent(event);
    });

    // Create highlight
    await waitFor(() => {
      const highlight = document.getElementById('dev-tools-hover-highlight');
      expect(highlight).toBeInTheDocument();
    });

    // Deactivate
    rerender({ isActive: false });

    await waitFor(() => {
      const highlight = document.getElementById('dev-tools-hover-highlight');
      expect(highlight).not.toBeInTheDocument();
    });

    elementFromPointSpy.mockRestore();
  });
});
