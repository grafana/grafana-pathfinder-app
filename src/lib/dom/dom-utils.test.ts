import {
  getAllTextContent,
  extractInteractiveDataFromElement,
  findButtonByText,
  resetValueTracker,
  reftargetExistsCheck,
  navmenuOpenCheck,
  getVisibleHighlightTarget,
} from './dom-utils';

// Mock console methods to avoid noise in tests
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

beforeEach(() => {
  console.warn = jest.fn();
  console.error = jest.fn();
});

afterEach(() => {
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
});

describe('getAllTextContent', () => {
  it('should extract text from a simple element', () => {
    const element = document.createElement('div');
    element.textContent = 'Hello World';

    const result = getAllTextContent(element);
    expect(result).toBe('Hello World');
  });

  it('should extract text from nested elements', () => {
    const element = document.createElement('div');
    element.innerHTML = '<span>Hello</span> <strong>World</strong>';

    const result = getAllTextContent(element);
    expect(result).toBe('Hello  World');
  });

  it('should handle mixed text and element nodes', () => {
    const element = document.createElement('div');
    element.innerHTML = 'Start <span>Middle</span> End';

    const result = getAllTextContent(element);
    expect(result).toBe('Start Middle End');
  });

  it('should handle empty element', () => {
    const element = document.createElement('div');

    const result = getAllTextContent(element);
    expect(result).toBe('');
  });

  it('should handle element with only whitespace', () => {
    const element = document.createElement('div');
    element.innerHTML = '   \n\t  ';

    const result = getAllTextContent(element);
    expect(result).toBe('');
  });

  it('should handle complex nested structure', () => {
    const element = document.createElement('div');
    element.innerHTML = `
      <header>Title</header>
      <main>
        <p>Paragraph 1</p>
        <p>Paragraph 2</p>
      </main>
      <footer>Footer</footer>
    `;

    const result = getAllTextContent(element);
    expect(result).toBe('Title  Paragraph 1  Paragraph 2  Footer');
  });
});

describe('extractInteractiveDataFromElement', () => {
  it('should extract basic interactive attributes', () => {
    const element = document.createElement('button');
    element.setAttribute('data-reftarget', 'Click me');
    element.setAttribute('data-targetaction', 'button');
    element.setAttribute('data-targetvalue', 'submit');
    element.setAttribute('data-requirements', 'logged-in');
    element.setAttribute('data-objectives', 'learn-navigation');
    element.textContent = 'Submit Form';
    element.className = 'btn-primary';
    element.id = 'submit-btn';

    const result = extractInteractiveDataFromElement(element);

    expect(result).toEqual({
      reftarget: 'Click me',
      targetaction: 'button',
      targetvalue: 'submit',
      requirements: 'logged-in',
      objectives: 'learn-navigation',
      skippable: false,
      tagName: 'button',
      className: 'btn-primary',
      id: 'submit-btn',
      textContent: 'Submit Form',
      parentTagName: undefined,
      timestamp: expect.any(Number),
      customData: undefined,
    });
  });

  it('should handle missing attributes gracefully', () => {
    const element = document.createElement('div');
    element.textContent = 'Simple element';

    const result = extractInteractiveDataFromElement(element);

    expect(result).toEqual({
      reftarget: '',
      targetaction: '',
      requirements: undefined,
      objectives: undefined,
      skippable: false,
      tagName: 'div',
      className: undefined,
      id: undefined,
      textContent: 'Simple element',
      targetvalue: undefined,
      parentTagName: undefined,
      timestamp: expect.any(Number),
      customData: undefined,
    });
  });

  it('should extract custom data attributes', () => {
    const element = document.createElement('div');
    element.setAttribute('data-reftarget', 'test');
    element.setAttribute('data-targetaction', 'highlight');
    element.setAttribute('data-custom-attr', 'custom-value');
    element.setAttribute('data-another-attr', 'another-value');

    const result = extractInteractiveDataFromElement(element);

    expect(result.customData).toEqual({
      'custom-attr': 'custom-value',
      'another-attr': 'another-value',
    });
  });

  it('should warn about suspicious reftarget values', () => {
    const element = document.createElement('div');
    element.setAttribute('data-reftarget', 'This is a very long suspicious value');
    element.textContent = 'This is a very long suspicious value';

    extractInteractiveDataFromElement(element);

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('reftarget "This is a very long suspicious value" matches element text')
    );
  });

  it('should not warn for short matching values', () => {
    const element = document.createElement('div');
    element.setAttribute('data-reftarget', 'short');
    element.textContent = 'short';

    extractInteractiveDataFromElement(element);

    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe('findButtonByText', () => {
  beforeEach(() => {
    // Create a proper document body for our tests
    document.body = document.createElement('body');
  });

  afterEach(() => {
    // Clean up
    if (document.body) {
      document.body.innerHTML = '';
    }
  });

  it('should find buttons with partial text match when no exact match', () => {
    const button1 = document.createElement('button');
    button1.textContent = 'Click me now';
    document.body.appendChild(button1);

    const button2 = document.createElement('button');
    button2.textContent = 'Submit form';
    document.body.appendChild(button2);

    const result = findButtonByText('Click me');

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(button1);
  });

  it('should handle case-insensitive matching', () => {
    const button = document.createElement('button');
    button.textContent = 'CLICK ME';
    document.body.appendChild(button);

    const result = findButtonByText('click me');

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(button);
  });

  it('should return empty array when no matches found', () => {
    const button = document.createElement('button');
    button.textContent = 'Submit';
    document.body.appendChild(button);

    const result = findButtonByText('Click me');

    expect(result).toHaveLength(0);
  });

  it('should handle empty or invalid input', () => {
    expect(findButtonByText('')).toHaveLength(0);
    expect(findButtonByText(null as any)).toHaveLength(0);
    expect(findButtonByText(undefined as any)).toHaveLength(0);
  });
});

describe('resetValueTracker', () => {
  it('should reset React value tracker if present', () => {
    const element = document.createElement('input');
    const mockTracker = { setValue: jest.fn() };
    (element as any)._valueTracker = mockTracker;

    resetValueTracker(element);

    expect(mockTracker.setValue).toHaveBeenCalledWith('');
  });

  it('should handle elements without value tracker', () => {
    const element = document.createElement('input');

    // Should not throw
    expect(() => resetValueTracker(element)).not.toThrow();
  });
});

describe('reftargetExistsCheck', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    // Create a container for our tests
    container = document.createElement('div');
    document.body = document.createElement('body');
    document.body.appendChild(container);
  });

  afterEach(() => {
    // Clean up
    if (document.body) {
      document.body.innerHTML = '';
    }
  });

  it('should check for button elements when targetAction is button', async () => {
    const button = document.createElement('button');
    button.textContent = 'Click me';
    container.appendChild(button);

    const result = await reftargetExistsCheck('Click me', 'button');

    expect(result).toEqual({
      requirement: 'exists-reftarget',
      pass: true,
    });
  });

  it('should fail when button not found for button action', async () => {
    const result = await reftargetExistsCheck('Non-existent button', 'button');

    expect(result).toEqual({
      requirement: 'exists-reftarget',
      pass: false,
      error: 'No buttons found containing text: "Non-existent button"',
    });
  });

  it('should check CSS selector for non-button actions', async () => {
    const div = document.createElement('div');
    div.id = 'test-element';
    container.appendChild(div);

    const result = await reftargetExistsCheck('#test-element', 'highlight');

    expect(result).toEqual({
      requirement: 'exists-reftarget',
      pass: true,
    });
  });

  it('should fail when CSS selector not found for non-button actions', async () => {
    const result = await reftargetExistsCheck('#non-existent', 'highlight');

    expect(result).toEqual({
      requirement: 'exists-reftarget',
      pass: false,
      error: 'Element not found: #non-existent',
    });
  });

  it('should handle partial button text matches', async () => {
    const button = document.createElement('button');
    button.textContent = 'Click me now';
    container.appendChild(button);

    const result = await reftargetExistsCheck('Click me', 'button');

    expect(result).toEqual({
      requirement: 'exists-reftarget',
      pass: true,
    });
  });
});

describe('navmenuOpenCheck', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    // Create a container for our tests
    container = document.createElement('div');
    document.body = document.createElement('body');
    document.body.appendChild(container);
  });

  afterEach(() => {
    // Clean up
    if (document.body) {
      document.body.innerHTML = '';
    }
  });

  it('should detect navigation menu with data-testid selector', async () => {
    const nav = document.createElement('div');
    nav.setAttribute('data-testid', 'data-testid navigation mega-menu');
    container.appendChild(nav);

    const result = await navmenuOpenCheck();

    expect(result).toEqual({
      requirement: 'navmenu-open',
      pass: true,
    });
  });

  it('should detect navigation menu with aria-label selector', async () => {
    const nav = document.createElement('ul');
    nav.setAttribute('aria-label', 'Navigation');
    container.appendChild(nav);

    const result = await navmenuOpenCheck();

    expect(result).toEqual({
      requirement: 'navmenu-open',
      pass: true,
    });
  });

  it('should detect navigation menu with nav aria-label selector', async () => {
    const nav = document.createElement('nav');
    nav.setAttribute('aria-label', 'Navigation');
    container.appendChild(nav);

    const result = await navmenuOpenCheck();

    expect(result).toEqual({
      requirement: 'navmenu-open',
      pass: true,
    });
  });

  it('should detect navigation menu with partial data-testid selector', async () => {
    const nav = document.createElement('div');
    nav.setAttribute('data-testid', 'some navigation menu');
    container.appendChild(nav);

    const result = await navmenuOpenCheck();

    expect(result).toEqual({
      requirement: 'navmenu-open',
      pass: true,
    });
  });

  it('should fail when no navigation menu is found', async () => {
    const result = await navmenuOpenCheck();

    expect(result).toEqual({
      requirement: 'navmenu-open',
      pass: false,
      error: 'Navigation menu not detected - menu may be closed or selector mismatch',
      canFix: true,
      fixType: 'navigation',
    });
  });

  it('should try selectors in order of preference', async () => {
    // Create elements that would match later selectors
    const nav1 = document.createElement('nav');
    nav1.setAttribute('aria-label', 'Navigation');
    container.appendChild(nav1);

    const nav2 = document.createElement('ul');
    nav2.setAttribute('aria-label', 'Main navigation');
    container.appendChild(nav2);

    const result = await navmenuOpenCheck();

    // Should find the first matching selector (aria-label="Navigation")
    expect(result).toEqual({
      requirement: 'navmenu-open',
      pass: true,
    });
  });
});

describe('reftargetExistsCheck with lazyRender option', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body = document.createElement('body');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (document.body) {
      document.body.innerHTML = '';
    }
  });

  it('should return lazy-scroll fixType when lazyRender is enabled and element not found', async () => {
    const result = await reftargetExistsCheck('#non-existent', 'highlight', {
      lazyRender: true,
      scrollContainer: '.my-scroll-container',
    });

    expect(result).toEqual({
      requirement: 'exists-reftarget',
      pass: false,
      error: 'Element not found - scroll dashboard to discover',
      canFix: true,
      fixType: 'lazy-scroll',
      scrollContainer: '.my-scroll-container',
    });
  });

  it('should use default scroll container when not specified', async () => {
    const result = await reftargetExistsCheck('#non-existent', 'highlight', {
      lazyRender: true,
    });

    expect(result).toEqual({
      requirement: 'exists-reftarget',
      pass: false,
      error: 'Element not found - scroll dashboard to discover',
      canFix: true,
      fixType: 'lazy-scroll',
      scrollContainer: '.scrollbar-view',
    });
  });

  it('should pass normally when element exists even with lazyRender enabled', async () => {
    const div = document.createElement('div');
    div.id = 'test-element';
    container.appendChild(div);

    const result = await reftargetExistsCheck('#test-element', 'highlight', {
      lazyRender: true,
    });

    expect(result).toEqual({
      requirement: 'exists-reftarget',
      pass: true,
    });
  });

  it('should return standard error when lazyRender is false', async () => {
    const result = await reftargetExistsCheck('#non-existent', 'highlight', {
      lazyRender: false,
    });

    expect(result).toEqual({
      requirement: 'exists-reftarget',
      pass: false,
      error: 'Element not found: #non-existent',
    });
  });
});

describe('scrollUntilElementFound', () => {
  let container: HTMLDivElement;
  let scrollContainer: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    scrollContainer = document.createElement('div');
    scrollContainer.className = 'scrollbar-view';
    // Mock scroll properties
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 0, writable: true });
    Object.defineProperty(scrollContainer, 'clientHeight', { value: 500, writable: true });
    Object.defineProperty(scrollContainer, 'scrollHeight', { value: 2000, writable: true });
    scrollContainer.scrollBy = jest.fn();

    document.body = document.createElement('body');
    document.body.appendChild(scrollContainer);
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (document.body) {
      document.body.innerHTML = '';
    }
  });

  it('should return element immediately if it already exists', async () => {
    const div = document.createElement('div');
    div.id = 'existing-element';
    container.appendChild(div);

    const { scrollUntilElementFound } = await import('./dom-utils');
    const result = await scrollUntilElementFound('#existing-element');

    expect(result).toBe(div);
    expect(scrollContainer.scrollBy).not.toHaveBeenCalled();
  });

  it('should return null when scroll container not found', async () => {
    const { scrollUntilElementFound } = await import('./dom-utils');
    const result = await scrollUntilElementFound('#non-existent', {
      scrollContainerSelector: '.non-existent-container',
    });

    expect(result).toBeNull();
  });

  it('should return null when element not found after scrolling', async () => {
    // Make it reach bottom quickly
    Object.defineProperty(scrollContainer, 'scrollHeight', { value: 500, writable: true });

    const { scrollUntilElementFound } = await import('./dom-utils');
    const result = await scrollUntilElementFound('#non-existent', {
      maxScrollAttempts: 2,
      waitTime: 10,
    });

    expect(result).toBeNull();
  });
});

describe('getVisibleHighlightTarget', () => {
  let container: HTMLDivElement;

  // Helper to mock element dimensions
  const mockDimensions = (element: HTMLElement, width: number, height: number) => {
    element.getBoundingClientRect = jest.fn(() => ({
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => {},
    }));
  };

  // Helper to mock computed style
  const mockComputedStyle = (element: HTMLElement, styles: Partial<CSSStyleDeclaration>) => {
    const originalGetComputedStyle = window.getComputedStyle;
    window.getComputedStyle = jest.fn((el) => {
      if (el === element) {
        return styles as CSSStyleDeclaration;
      }
      return originalGetComputedStyle(el);
    });
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body = document.createElement('body');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (document.body) {
      document.body.innerHTML = '';
    }
    jest.restoreAllMocks();
  });

  it('should return non-input elements as-is', () => {
    const button = document.createElement('button');
    button.textContent = 'Click me';
    container.appendChild(button);

    const result = getVisibleHighlightTarget(button);

    expect(result).toBe(button);
  });

  it('should return div elements as-is', () => {
    const div = document.createElement('div');
    container.appendChild(div);

    const result = getVisibleHighlightTarget(div);

    expect(result).toBe(div);
  });

  it('should return input without grid pattern as-is', () => {
    const input = document.createElement('input');
    input.value = 'some value';
    container.appendChild(input);

    mockComputedStyle(input, { gridArea: 'auto' } as any);

    const result = getVisibleHighlightTarget(input);

    // No grid pattern, return as-is
    expect(result).toBe(input);
  });

  it('should return input with grid but non-empty value as-is', () => {
    const input = document.createElement('input');
    input.value = 'user typing';
    container.appendChild(input);

    mockComputedStyle(input, { gridArea: '1 / 2' } as any);

    const result = getVisibleHighlightTarget(input);

    // Has grid but not empty, return as-is
    expect(result).toBe(input);
  });

  it('should find input-wrapper for grid-overlaid empty input', () => {
    // Simulate Grafana/React Select structure with input-wrapper
    const outerContainer = document.createElement('div');
    outerContainer.setAttribute('data-testid', 'collector-os-selection');
    outerContainer.style.width = '250px';
    outerContainer.style.height = '38px';

    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'css-1us8eja-input-wrapper css-1age63q';
    inputWrapper.style.width = '250px';
    inputWrapper.style.height = '38px';

    const input = document.createElement('input');
    input.style.gridArea = '1 / 2';
    input.value = '';

    inputWrapper.appendChild(input);
    outerContainer.appendChild(inputWrapper);
    container.appendChild(outerContainer);

    mockDimensions(input, 2, 20);
    mockDimensions(inputWrapper, 250, 38);
    mockDimensions(outerContainer, 250, 38);
    mockComputedStyle(input, { gridArea: '1 / 2' } as any);

    const result = getVisibleHighlightTarget(input);

    // Should use fast path and return the input-wrapper directly
    expect(result).toBe(inputWrapper);
    expect(result.className).toContain('input-wrapper');
  });

  it('should return original input if no input-wrapper found', () => {
    // Grid-overlaid input but no input-wrapper parent
    const dropdown = document.createElement('div');
    dropdown.setAttribute('data-testid', 'collector-os-selection');

    const input = document.createElement('input');
    input.value = '';

    dropdown.appendChild(input);
    container.appendChild(dropdown);

    mockComputedStyle(input, { gridArea: '1 / 2' } as any);

    const result = getVisibleHighlightTarget(input);

    // No input-wrapper class found, return original
    expect(result).toBe(input);
  });

  it('should find input-wrapper within 5 levels', () => {
    const wrapper = document.createElement('div');
    wrapper.className = 'css-abc-input-wrapper';

    const middle1 = document.createElement('div');
    const middle2 = document.createElement('div');
    const middle3 = document.createElement('div');
    const middle4 = document.createElement('div');

    const input = document.createElement('input');
    input.value = '';

    middle4.appendChild(input);
    middle3.appendChild(middle4);
    middle2.appendChild(middle3);
    middle1.appendChild(middle2);
    wrapper.appendChild(middle1);
    container.appendChild(wrapper);

    mockComputedStyle(input, { gridArea: '1 / 2' } as any);

    const result = getVisibleHighlightTarget(input);

    expect(result).toBe(wrapper);
  });

  it('should not search beyond 5 levels', () => {
    // Wrapper is 6 levels up (too far)
    const wrapper = document.createElement('div');
    wrapper.className = 'css-abc-input-wrapper';

    const middle1 = document.createElement('div');
    const middle2 = document.createElement('div');
    const middle3 = document.createElement('div');
    const middle4 = document.createElement('div');
    const middle5 = document.createElement('div');

    const input = document.createElement('input');
    input.value = '';

    middle5.appendChild(input);
    middle4.appendChild(middle5);
    middle3.appendChild(middle4);
    middle2.appendChild(middle3);
    middle1.appendChild(middle2);
    wrapper.appendChild(middle1);
    container.appendChild(wrapper);

    mockComputedStyle(input, { gridArea: '1 / 2' } as any);

    const result = getVisibleHighlightTarget(input);

    // Should not find wrapper (beyond maxDepth=5), return original
    expect(result).toBe(input);
  });
});
