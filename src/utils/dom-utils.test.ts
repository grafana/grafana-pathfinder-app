import { 
  getAllTextContent, 
  extractInteractiveDataFromElement, 
  findButtonByText, 
  resetValueTracker 
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

  it('should handle missing attributes gracefully', () => {
    const element = document.createElement('div');
    element.setAttribute('data-reftarget', 'test');
    element.setAttribute('data-targetaction', 'button');
    
    const result = extractInteractiveDataFromElement(element);
    
    expect(result).toEqual({
      reftarget: 'test',
      targetaction: 'button',
      targetvalue: undefined,
      requirements: undefined,
      objectives: undefined,
      tagName: 'div',
      className: undefined,
      id: undefined,
      textContent: undefined,
      parentTagName: undefined,
      timestamp: expect.any(Number),
      customData: undefined,
    });
  });

  it('should warn when reftarget matches element text', () => {
    const element = document.createElement('button');
    element.setAttribute('data-reftarget', 'Click this button');
    element.setAttribute('data-targetaction', 'button');
    element.textContent = 'Click this button';
    
    extractInteractiveDataFromElement(element);
    
    expect(console.warn).toHaveBeenCalledWith(
      '⚠️ reftarget "Click this button" matches element text - check data-reftarget attribute'
    );
  });

  it('should not warn for short reftarget matches', () => {
    const element = document.createElement('button');
    element.setAttribute('data-reftarget', 'OK');
    element.setAttribute('data-targetaction', 'button');
    element.textContent = 'OK';
    
    extractInteractiveDataFromElement(element);
    
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('should include parent tag name when available', () => {
    const parent = document.createElement('form');
    const element = document.createElement('button');
    element.setAttribute('data-reftarget', 'test');
    element.setAttribute('data-targetaction', 'button');
    parent.appendChild(element);
    
    const result = extractInteractiveDataFromElement(element);
    
    expect(result.parentTagName).toBe('form');
  });
});

describe('findButtonByText', () => {
  beforeEach(() => {
    // Clear any existing buttons
    document.body.innerHTML = '';
  });

  it('should find exact matches', () => {
    const button1 = document.createElement('button');
    button1.textContent = 'Submit';
    const button2 = document.createElement('button');
    button2.textContent = 'Cancel';
    document.body.appendChild(button1);
    document.body.appendChild(button2);
    
    const result = findButtonByText('Submit');
    
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(button1);
    expect(console.warn).toHaveBeenCalledWith('🎯 Found 1 exact matches for "Submit"');
  });

  it('should find partial matches when no exact match', () => {
    const button1 = document.createElement('button');
    button1.textContent = 'Submit Form';
    const button2 = document.createElement('button');
    button2.textContent = 'Cancel';
    document.body.appendChild(button1);
    document.body.appendChild(button2);
    
    const result = findButtonByText('Submit');
    
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(button1);
    expect(console.warn).toHaveBeenCalledWith('🔍 Found 1 partial matches for "Submit"');
  });

  it('should handle case-insensitive matching', () => {
    const button = document.createElement('button');
    button.textContent = 'SUBMIT FORM';
    document.body.appendChild(button);
    
    const result = findButtonByText('submit');
    
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(button);
  });

  it('should handle buttons with nested elements', () => {
    const button = document.createElement('button');
    button.innerHTML = '<span>Submit</span> <strong>Form</strong>';
    document.body.appendChild(button);
    
    const result = findButtonByText('Submit  Form');
    
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(button);
  });

  it('should return empty array for no matches', () => {
    const button = document.createElement('button');
    button.textContent = 'Submit';
    document.body.appendChild(button);
    
    const result = findButtonByText('Non-existent');
    
    expect(result).toHaveLength(0);
  });

  it('should handle invalid input', () => {
    const result1 = findButtonByText('');
    const result2 = findButtonByText(null as any);
    const result3 = findButtonByText(undefined as any);
    
    expect(result1).toHaveLength(0);
    expect(result2).toHaveLength(0);
    expect(result3).toHaveLength(0);
  });

  it('should prioritize exact matches over partial matches', () => {
    const exactButton = document.createElement('button');
    exactButton.textContent = 'Submit';
    const partialButton = document.createElement('button');
    partialButton.textContent = 'Submit Form';
    document.body.appendChild(exactButton);
    document.body.appendChild(partialButton);
    
    const result = findButtonByText('Submit');
    
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(exactButton);
    expect(console.warn).toHaveBeenCalledWith('🎯 Found 1 exact matches for "Submit"');
  });

  it('should handle multiple exact matches', () => {
    const button1 = document.createElement('button');
    button1.textContent = 'Submit';
    const button2 = document.createElement('button');
    button2.textContent = 'Submit';
    document.body.appendChild(button1);
    document.body.appendChild(button2);
    
    const result = findButtonByText('Submit');
    
    expect(result).toHaveLength(2);
    expect(result).toContain(button1);
    expect(result).toContain(button2);
    expect(console.warn).toHaveBeenCalledWith('🎯 Found 2 exact matches for "Submit"');
  });
});

describe('resetValueTracker', () => {
  it('should reset value tracker when present', () => {
    const element = document.createElement('input');
    const mockSetValue = jest.fn();
    (element as any)._valueTracker = {
      setValue: mockSetValue
    };
    
    resetValueTracker(element);
    
    expect(mockSetValue).toHaveBeenCalledWith('');
  });

  it('should not throw when value tracker is not present', () => {
    const element = document.createElement('input');
    
    expect(() => resetValueTracker(element)).not.toThrow();
  });

  it('should not throw when value tracker is null', () => {
    const element = document.createElement('input');
    (element as any)._valueTracker = null;
    
    expect(() => resetValueTracker(element)).not.toThrow();
  });

  it('should not throw when value tracker is undefined', () => {
    const element = document.createElement('input');
    (element as any)._valueTracker = undefined;
    
    expect(() => resetValueTracker(element)).not.toThrow();
  });
}); 
