import { querySelectorEnhanced, querySelectorAllEnhanced, getBrowserSelectorSupport } from './enhanced-selector';

describe('Enhanced Selector Engine', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    // Create a fresh container for each test
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    // Clean up after each test
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  describe('Basic selector support', () => {
    it('should handle standard CSS selectors', () => {
      container.innerHTML = `
        <div class="test-class" id="test-id">
          <p>Test content</p>
        </div>
      `;

      const result = querySelectorAllEnhanced('.test-class');
      expect(result.elements).toHaveLength(1);
      expect(result.usedFallback).toBe(false);
      expect(result.elements[0].id).toBe('test-id');
    });

    it('should handle attribute selectors', () => {
      container.innerHTML = `
        <div data-cy="wb-list-item">
          <p>Test content</p>
        </div>
      `;

      const result = querySelectorAllEnhanced('div[data-cy="wb-list-item"]');
      expect(result.elements).toHaveLength(1);
      expect(result.usedFallback).toBe(false);
    });
  });

  describe(':contains() selector support', () => {
    beforeEach(() => {
      container.innerHTML = `
        <div data-cy="wb-list-item">
          <p>checkoutservice</p>
          <span>Other text</span>
        </div>
        <div data-cy="wb-list-item">
          <p>userservice</p>
          <span>Different text</span>
        </div>
        <div data-cy="other-item">
          <p>checkoutservice</p>
        </div>
      `;
    });

    it('should find elements containing specific text', () => {
      const result = querySelectorAllEnhanced('div[data-cy="wb-list-item"]:contains("checkoutservice")');

      expect(result.elements).toHaveLength(1);
      expect(result.usedFallback).toBe(true);
      expect(result.effectiveSelector).toContain('text contains "checkoutservice"');

      const foundElement = result.elements[0];
      expect(foundElement.getAttribute('data-cy')).toBe('wb-list-item');
      expect(foundElement.textContent).toContain('checkoutservice');
    });

    it('should handle case-insensitive text matching', () => {
      const result = querySelectorAllEnhanced('div[data-cy="wb-list-item"]:contains("CHECKOUTSERVICE")');

      expect(result.elements).toHaveLength(1);
      expect(result.usedFallback).toBe(true);
    });

    it('should return empty array when text not found', () => {
      const result = querySelectorAllEnhanced('div[data-cy="wb-list-item"]:contains("nonexistent")');

      expect(result.elements).toHaveLength(0);
      expect(result.usedFallback).toBe(true);
    });

    it('should handle quoted and unquoted text in :contains()', () => {
      const quotedResult = querySelectorAllEnhanced('div:contains("checkoutservice")');
      const unquotedResult = querySelectorAllEnhanced('div:contains(checkoutservice)');

      // Should find all divs that contain "checkoutservice" (including the container)
      expect(quotedResult.elements.length).toBeGreaterThanOrEqual(2);
      expect(unquotedResult.elements.length).toBeGreaterThanOrEqual(2);

      // Verify we found the right elements (filter out the container div)
      const quotedSpecific = quotedResult.elements.filter((el) => el.getAttribute('data-cy'));
      expect(quotedSpecific.length).toBeGreaterThanOrEqual(2);

      const foundCyValues = quotedSpecific.map((el) => el.getAttribute('data-cy'));
      expect(foundCyValues).toContain('wb-list-item');
      expect(foundCyValues).toContain('other-item');
    });
  });

  describe(':has() selector support', () => {
    beforeEach(() => {
      container.innerHTML = `
        <div data-cy="wb-list-item">
          <p>checkoutservice</p>
          <span>metadata</span>
        </div>
        <div data-cy="wb-list-item">
          <span>userservice</span>
          <div>no paragraph</div>
        </div>
        <div data-cy="other-item">
          <p>checkoutservice</p>
        </div>
      `;
    });

    it('should find elements that have specific descendants', () => {
      const result = querySelectorAllEnhanced('div[data-cy="wb-list-item"]:has(p)');

      expect(result.elements).toHaveLength(1);
      // May use fallback depending on browser support

      const foundElement = result.elements[0];
      expect(foundElement.getAttribute('data-cy')).toBe('wb-list-item');
      expect(foundElement.querySelector('p')).toBeTruthy();
    });

    it('should handle nested :contains() within :has()', () => {
      const result = querySelectorAllEnhanced('div[data-cy="wb-list-item"]:has(p:contains("checkoutservice"))');

      expect(result.elements).toHaveLength(1);
      expect(result.usedFallback).toBe(true); // :contains() always uses fallback

      const foundElement = result.elements[0];
      expect(foundElement.getAttribute('data-cy')).toBe('wb-list-item');
      expect(foundElement.querySelector('p')?.textContent).toBe('checkoutservice');
    });

    it('should return empty array when :has() condition not met', () => {
      const result = querySelectorAllEnhanced('div[data-cy="wb-list-item"]:has(table)');

      expect(result.elements).toHaveLength(0);
    });
  });

  describe('Complex combined selectors', () => {
    beforeEach(() => {
      container.innerHTML = `
        <article class="service-card">
          <div data-cy="wb-list-item" data-service="checkout">
            <h3>Checkout Service</h3>
            <p>checkoutservice</p>
            <button>Configure</button>
          </div>
        </article>
        <article class="service-card">
          <div data-cy="wb-list-item" data-service="user">
            <h3>User Service</h3>
            <p>userservice</p>
            <button>Configure</button>
          </div>
        </article>
      `;
    });

    it('should handle the exact selector from the user query', () => {
      const result = querySelectorAllEnhanced('div[data-cy="wb-list-item"]:has(p:contains("checkoutservice"))');

      expect(result.elements).toHaveLength(1);
      expect(result.usedFallback).toBe(true);

      const foundElement = result.elements[0];
      expect(foundElement.getAttribute('data-service')).toBe('checkout');
      expect(foundElement.querySelector('p')?.textContent).toBe('checkoutservice');
    });

    it('should handle descendant selectors after :has() (Prometheus tutorial case)', () => {
      // Add test HTML that matches the Prometheus tutorial structure
      container.innerHTML = `
        <div class="css-1ikwcqc">
          <h6>Performance</h6>
          <div data-testid="data-testid prometheus type">Target Dropdown</div>
          <div>Other content</div>
        </div>
        <div class="css-other">
          <h6>Other Section</h6>
          <div data-testid="data-testid prometheus type">Wrong Dropdown</div>
        </div>
      `;

      const result = querySelectorAllEnhanced(
        'div[class]:has(h6:contains("Performance")) [data-testid="data-testid prometheus type"]'
      );

      expect(result.elements).toHaveLength(1);
      expect(result.usedFallback).toBe(true);

      const foundElement = result.elements[0];
      expect(foundElement.textContent).toBe('Target Dropdown');
      expect(foundElement.getAttribute('data-testid')).toBe('data-testid prometheus type');
    });

    it('should find buttons within matched complex selectors', () => {
      // First find the container with our complex selector
      const containerResult = querySelectorAllEnhanced(
        'div[data-cy="wb-list-item"]:has(p:contains("checkoutservice"))'
      );
      expect(containerResult.elements).toHaveLength(1);

      // Then find button within that container
      const button = containerResult.elements[0].querySelector('button');
      expect(button).toBeTruthy();
      expect(button?.textContent).toBe('Configure');
    });
  });

  describe('Error handling', () => {
    it('should handle invalid :contains() syntax gracefully', () => {
      const result = querySelectorAllEnhanced('div:contains(unclosed');

      expect(result.elements).toHaveLength(0);
      expect(result.usedFallback).toBe(true);
      expect(result.effectiveSelector).toBe('UNSUPPORTED'); // Goes to unsupported because regex fails
    });

    it('should handle invalid :has() syntax gracefully', () => {
      const result = querySelectorAllEnhanced('div:has(unclosed');

      expect(result.elements).toHaveLength(0);
      expect(result.usedFallback).toBe(true);
      expect(result.effectiveSelector).toBe('UNSUPPORTED'); // Goes to unsupported because parsing fails
    });

    it('should handle completely invalid selectors', () => {
      const result = querySelectorAllEnhanced('div:unknown-pseudo()');

      expect(result.elements).toHaveLength(0);
      expect(result.usedFallback).toBe(true);
      expect(result.effectiveSelector).toBe('UNSUPPORTED');
    });
  });

  describe('querySelectorEnhanced (single element)', () => {
    beforeEach(() => {
      container.innerHTML = `
        <div data-cy="wb-list-item">
          <p>checkoutservice</p>
        </div>
        <div data-cy="wb-list-item">
          <p>userservice</p>
        </div>
      `;
    });

    it('should return first matching element', () => {
      const element = querySelectorEnhanced('div[data-cy="wb-list-item"]:contains("checkoutservice")');

      expect(element).toBeTruthy();
      expect(element?.textContent).toContain('checkoutservice');
    });

    it('should return null when no matches found', () => {
      const element = querySelectorEnhanced('div:contains("nonexistent")');

      expect(element).toBeNull();
    });
  });

  describe('Browser support detection', () => {
    it('should detect browser capabilities', () => {
      const support = getBrowserSelectorSupport();

      expect(support).toHaveProperty('hasSelector');
      expect(support).toHaveProperty('containsSelector');
      expect(support).toHaveProperty('version');
      expect(support.containsSelector).toBe(false); // :contains() never supported natively
    });
  });
});
