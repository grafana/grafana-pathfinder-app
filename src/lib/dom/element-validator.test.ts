import {
  isElementVisible,
  hasFixedPosition,
  getScrollParent,
  isInViewport,
  hasCustomScrollParent,
  getElementVisibilityInfo,
} from './element-validator';

describe('element-validator', () => {
  describe('isElementVisible', () => {
    it('should return false for null element', () => {
      expect(isElementVisible(null)).toBe(false);
    });

    it('should return true for visible element', () => {
      const element = document.createElement('div');
      document.body.appendChild(element);

      expect(isElementVisible(element)).toBe(true);

      document.body.removeChild(element);
    });

    it('should return false for element with display: none', () => {
      const element = document.createElement('div');
      element.style.display = 'none';
      document.body.appendChild(element);

      expect(isElementVisible(element)).toBe(false);

      document.body.removeChild(element);
    });

    it('should return false for element with visibility: hidden', () => {
      const element = document.createElement('div');
      element.style.visibility = 'hidden';
      document.body.appendChild(element);

      expect(isElementVisible(element)).toBe(false);

      document.body.removeChild(element);
    });

    it('should return false for element with opacity: 0', () => {
      const element = document.createElement('div');
      element.style.opacity = '0';
      document.body.appendChild(element);

      expect(isElementVisible(element)).toBe(false);

      document.body.removeChild(element);
    });

    it('should return false when parent has display: none', () => {
      const parent = document.createElement('div');
      const child = document.createElement('div');
      parent.style.display = 'none';
      parent.appendChild(child);
      document.body.appendChild(parent);

      expect(isElementVisible(child)).toBe(false);

      document.body.removeChild(parent);
    });

    it('should return false when parent has visibility: hidden', () => {
      const parent = document.createElement('div');
      const child = document.createElement('div');
      parent.style.visibility = 'hidden';
      parent.appendChild(child);
      document.body.appendChild(parent);

      expect(isElementVisible(child)).toBe(false);

      document.body.removeChild(parent);
    });

    it('should exclude global interaction blocker overlays from checks', () => {
      const overlay = document.createElement('div');
      overlay.id = 'interactive-blocking-overlay';
      overlay.style.display = 'block';
      document.body.appendChild(overlay);

      const child = document.createElement('div');
      overlay.appendChild(child);

      // Child should be considered visible despite being inside overlay
      expect(isElementVisible(child)).toBe(true);

      document.body.removeChild(overlay);
    });

    it('should exclude header overlay from checks', () => {
      const overlay = document.createElement('div');
      overlay.id = 'interactive-header-overlay';
      overlay.style.display = 'block';
      document.body.appendChild(overlay);

      const child = document.createElement('div');
      overlay.appendChild(child);

      expect(isElementVisible(child)).toBe(true);

      document.body.removeChild(overlay);
    });

    it('should exclude fullscreen overlay from checks', () => {
      const overlay = document.createElement('div');
      overlay.id = 'interactive-fullscreen-overlay';
      overlay.style.display = 'block';
      document.body.appendChild(overlay);

      const child = document.createElement('div');
      overlay.appendChild(child);

      expect(isElementVisible(child)).toBe(true);

      document.body.removeChild(overlay);
    });
  });

  describe('hasFixedPosition', () => {
    it('should return false for null element', () => {
      expect(hasFixedPosition(null)).toBe(false);
    });

    it('should return false for document.body', () => {
      expect(hasFixedPosition(document.body)).toBe(false);
    });

    it('should return false for element with static position', () => {
      const element = document.createElement('div');
      element.style.position = 'static';
      document.body.appendChild(element);

      expect(hasFixedPosition(element)).toBe(false);

      document.body.removeChild(element);
    });

    it('should return true for element with fixed position', () => {
      const element = document.createElement('div');
      element.style.position = 'fixed';
      document.body.appendChild(element);

      expect(hasFixedPosition(element)).toBe(true);

      document.body.removeChild(element);
    });

    it('should return true for element with sticky position', () => {
      const element = document.createElement('div');
      element.style.position = 'sticky';
      document.body.appendChild(element);

      expect(hasFixedPosition(element)).toBe(true);

      document.body.removeChild(element);
    });

    it('should return true when parent has fixed position', () => {
      const parent = document.createElement('div');
      parent.style.position = 'fixed';
      const child = document.createElement('div');
      parent.appendChild(child);
      document.body.appendChild(parent);

      expect(hasFixedPosition(child)).toBe(true);

      document.body.removeChild(parent);
    });

    it('should traverse multiple parents to find fixed position', () => {
      const grandparent = document.createElement('div');
      grandparent.style.position = 'fixed';
      const parent = document.createElement('div');
      const child = document.createElement('div');
      grandparent.appendChild(parent);
      parent.appendChild(child);
      document.body.appendChild(grandparent);

      expect(hasFixedPosition(child)).toBe(true);

      document.body.removeChild(grandparent);
    });
  });

  describe('getScrollParent', () => {
    it('should return document.documentElement for null element', () => {
      expect(getScrollParent(null)).toBe(document.documentElement);
    });

    it('should return document.documentElement when no scrollable parent exists', () => {
      const element = document.createElement('div');
      document.body.appendChild(element);

      expect(getScrollParent(element)).toBe(document.documentElement);

      document.body.removeChild(element);
    });

    it('should find parent with overflow: auto', () => {
      const parent = document.createElement('div');
      parent.style.overflow = 'auto';
      parent.style.height = '100px';
      const child = document.createElement('div');
      child.style.height = '200px';
      parent.appendChild(child);
      document.body.appendChild(parent);

      // Mock scrollHeight/clientHeight for JSDOM
      Object.defineProperty(parent, 'scrollHeight', { value: 200, writable: true });
      Object.defineProperty(parent, 'clientHeight', { value: 100, writable: true });

      expect(getScrollParent(child)).toBe(parent);

      document.body.removeChild(parent);
    });

    it('should find parent with overflow: scroll', () => {
      const parent = document.createElement('div');
      parent.style.overflow = 'scroll';
      parent.style.height = '100px';
      const child = document.createElement('div');
      child.style.height = '200px';
      parent.appendChild(child);
      document.body.appendChild(parent);

      // Mock scrollHeight/clientHeight for JSDOM
      Object.defineProperty(parent, 'scrollHeight', { value: 200, writable: true });
      Object.defineProperty(parent, 'clientHeight', { value: 100, writable: true });

      expect(getScrollParent(child)).toBe(parent);

      document.body.removeChild(parent);
    });

    it('should find parent with overflowY: auto', () => {
      const parent = document.createElement('div');
      parent.style.overflowY = 'auto';
      parent.style.height = '100px';
      const child = document.createElement('div');
      child.style.height = '200px';
      parent.appendChild(child);
      document.body.appendChild(parent);

      // Mock scrollHeight/clientHeight for JSDOM
      Object.defineProperty(parent, 'scrollHeight', { value: 200, writable: true });
      Object.defineProperty(parent, 'clientHeight', { value: 100, writable: true });

      expect(getScrollParent(child)).toBe(parent);

      document.body.removeChild(parent);
    });

    it('should skip parent without scrollable content', () => {
      const parent = document.createElement('div');
      parent.style.overflow = 'auto';
      parent.style.height = '200px'; // Larger than child
      const child = document.createElement('div');
      child.style.height = '100px';
      parent.appendChild(child);
      document.body.appendChild(parent);

      // Should skip parent and return document.documentElement
      expect(getScrollParent(child)).toBe(document.documentElement);

      document.body.removeChild(parent);
    });
  });

  describe('isInViewport', () => {
    it('should return false for null element', () => {
      expect(isInViewport(null)).toBe(false);
    });

    it('should return true for element in viewport', () => {
      const element = document.createElement('div');
      element.style.position = 'fixed';
      element.style.top = '10px';
      element.style.left = '10px';
      element.style.width = '100px';
      element.style.height = '100px';
      document.body.appendChild(element);

      // Mock getBoundingClientRect for JSDOM
      element.getBoundingClientRect = jest.fn().mockReturnValue({
        top: 10,
        left: 10,
        bottom: 110,
        right: 110,
        width: 100,
        height: 100,
      });

      expect(isInViewport(element)).toBe(true);

      document.body.removeChild(element);
    });

    it('should return false for element above viewport', () => {
      const element = document.createElement('div');
      element.style.position = 'fixed';
      element.style.top = '-200px';
      element.style.left = '10px';
      element.style.width = '100px';
      element.style.height = '100px';
      document.body.appendChild(element);

      expect(isInViewport(element)).toBe(false);

      document.body.removeChild(element);
    });

    it('should return false for element below viewport', () => {
      const element = document.createElement('div');
      element.style.position = 'fixed';
      element.style.top = '10000px';
      element.style.left = '10px';
      element.style.width = '100px';
      element.style.height = '100px';
      document.body.appendChild(element);

      expect(isInViewport(element)).toBe(false);

      document.body.removeChild(element);
    });

    it('should return false for element left of viewport', () => {
      const element = document.createElement('div');
      element.style.position = 'fixed';
      element.style.top = '10px';
      element.style.left = '-200px';
      element.style.width = '100px';
      element.style.height = '100px';
      document.body.appendChild(element);

      expect(isInViewport(element)).toBe(false);

      document.body.removeChild(element);
    });

    it('should return false for element right of viewport', () => {
      const element = document.createElement('div');
      element.style.position = 'fixed';
      element.style.top = '10px';
      element.style.left = '10000px';
      element.style.width = '100px';
      element.style.height = '100px';
      document.body.appendChild(element);

      expect(isInViewport(element)).toBe(false);

      document.body.removeChild(element);
    });

    it('should respect visibility threshold', () => {
      const element = document.createElement('div');
      element.style.position = 'fixed';
      element.style.top = '0';
      element.style.left = '0';
      element.style.width = '100px';
      element.style.height = '100px';
      document.body.appendChild(element);

      // Mock getBoundingClientRect for JSDOM
      element.getBoundingClientRect = jest.fn().mockReturnValue({
        top: 0,
        left: 0,
        bottom: 100,
        right: 100,
        width: 100,
        height: 100,
      });

      // With 0 threshold (default), any part visible
      expect(isInViewport(element, 0)).toBe(true);

      // With 1.0 threshold, entire element must be visible
      expect(isInViewport(element, 1.0)).toBe(true);

      document.body.removeChild(element);
    });
  });

  describe('hasCustomScrollParent', () => {
    it('should return false for null element', () => {
      expect(hasCustomScrollParent(null)).toBe(false);
    });

    it('should return false when scroll parent is document', () => {
      const element = document.createElement('div');
      document.body.appendChild(element);

      expect(hasCustomScrollParent(element)).toBe(false);

      document.body.removeChild(element);
    });

    it('should return true when element has custom scroll parent', () => {
      const parent = document.createElement('div');
      parent.style.overflow = 'auto';
      parent.style.height = '100px';
      const child = document.createElement('div');
      child.style.height = '200px';
      parent.appendChild(child);
      document.body.appendChild(parent);

      // Mock scrollHeight/clientHeight for JSDOM
      Object.defineProperty(parent, 'scrollHeight', { value: 200, writable: true });
      Object.defineProperty(parent, 'clientHeight', { value: 100, writable: true });

      expect(hasCustomScrollParent(child)).toBe(true);

      document.body.removeChild(parent);
    });
  });

  describe('getElementVisibilityInfo', () => {
    it('should return false values for null element', () => {
      const info = getElementVisibilityInfo(null);

      expect(info.exists).toBe(false);
      expect(info.isVisible).toBe(false);
      expect(info.isInViewport).toBe(false);
      expect(info.hasFixedPosition).toBe(false);
      expect(info.hasCustomScrollParent).toBe(false);
      expect(info.scrollParent).toBe(null);
      expect(info.computedStyle).toBe(null);
    });

    it('should return comprehensive info for visible element', () => {
      const element = document.createElement('div');
      element.style.position = 'fixed';
      element.style.top = '10px';
      element.style.left = '10px';
      element.style.width = '100px';
      element.style.height = '100px';
      document.body.appendChild(element);

      // Mock getBoundingClientRect for JSDOM
      element.getBoundingClientRect = jest.fn().mockReturnValue({
        top: 10,
        left: 10,
        bottom: 110,
        right: 110,
        width: 100,
        height: 100,
      });

      const info = getElementVisibilityInfo(element);

      expect(info.exists).toBe(true);
      expect(info.isVisible).toBe(true);
      expect(info.isInViewport).toBe(true);
      expect(info.hasFixedPosition).toBe(true);
      expect(info.hasCustomScrollParent).toBe(false);
      expect(info.scrollParent).toBe(document.documentElement);
      expect(info.computedStyle).not.toBe(null);

      document.body.removeChild(element);
    });

    it('should return info for hidden element', () => {
      const element = document.createElement('div');
      element.style.display = 'none';
      document.body.appendChild(element);

      const info = getElementVisibilityInfo(element);

      expect(info.exists).toBe(true);
      expect(info.isVisible).toBe(false);
      expect(info.computedStyle?.display).toBe('none');

      document.body.removeChild(element);
    });
  });
});
