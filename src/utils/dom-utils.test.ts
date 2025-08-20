import {
  getAllTextContent,
  extractInteractiveDataFromElement,
  findButtonByText,
  resetValueTracker,
  reftargetExistsCHECK,
  navmenuOpenCHECK,
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
      tagName: 'div',
      className: undefined,
      id: undefined,
      textContent: 'Simple element',
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
      expect.stringContaining('⚠️ reftarget "This is a very long suspicious value" matches element text')
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

describe('reftargetExistsCHECK', () => {
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

    const result = await reftargetExistsCHECK('Click me', 'button');

    expect(result).toEqual({
      requirement: 'exists-reftarget',
      pass: true,
    });
  });

  it('should fail when button not found for button action', async () => {
    const result = await reftargetExistsCHECK('Non-existent button', 'button');

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

    const result = await reftargetExistsCHECK('#test-element', 'highlight');

    expect(result).toEqual({
      requirement: 'exists-reftarget',
      pass: true,
    });
  });

  it('should fail when CSS selector not found for non-button actions', async () => {
    const result = await reftargetExistsCHECK('#non-existent', 'highlight');

    expect(result).toEqual({
      requirement: 'exists-reftarget',
      pass: false,
      error: 'Element not found',
    });
  });

  it('should handle partial button text matches', async () => {
    const button = document.createElement('button');
    button.textContent = 'Click me now';
    container.appendChild(button);

    const result = await reftargetExistsCHECK('Click me', 'button');

    expect(result).toEqual({
      requirement: 'exists-reftarget',
      pass: true,
    });
  });
});

describe('navmenuOpenCHECK', () => {
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

    const result = await navmenuOpenCHECK();

    expect(result).toEqual({
      requirement: 'navmenu-open',
      pass: true,
    });
  });

  it('should detect navigation menu with aria-label selector', async () => {
    const nav = document.createElement('ul');
    nav.setAttribute('aria-label', 'Navigation');
    container.appendChild(nav);

    const result = await navmenuOpenCHECK();

    expect(result).toEqual({
      requirement: 'navmenu-open',
      pass: true,
    });
  });

  it('should detect navigation menu with CSS class selector', async () => {
    const nav = document.createElement('nav');
    nav.className = 'css-rs8tod';
    container.appendChild(nav);

    const result = await navmenuOpenCHECK();

    expect(result).toEqual({
      requirement: 'navmenu-open',
      pass: true,
    });
  });

  it('should detect navigation menu with partial data-testid selector', async () => {
    const nav = document.createElement('div');
    nav.setAttribute('data-testid', 'some navigation menu');
    container.appendChild(nav);

    const result = await navmenuOpenCHECK();

    expect(result).toEqual({
      requirement: 'navmenu-open',
      pass: true,
    });
  });

  it('should fail when no navigation menu is found', async () => {
    const result = await navmenuOpenCHECK();

    expect(result).toEqual({
      requirement: 'navmenu-open',
      pass: false,
      error: 'Navigation menu not detected - menu may be closed or selector mismatch',
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

    const result = await navmenuOpenCHECK();

    // Should find the first matching selector (aria-label="Navigation")
    expect(result).toEqual({
      requirement: 'navmenu-open',
      pass: true,
    });
  });
});
