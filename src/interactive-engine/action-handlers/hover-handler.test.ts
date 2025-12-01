import { HoverHandler } from './hover-handler';
import { InteractiveStateManager } from '../interactive-state-manager';
import { NavigationManager } from '../navigation-manager';
import { InteractiveElementData } from '../../types/interactive.types';

// Mock dependencies
jest.mock('../interactive-state-manager');
jest.mock('../navigation-manager');
jest.mock('../../lib/dom', () => ({
  querySelectorAllEnhanced: jest.fn().mockReturnValue({ elements: [], usedFallback: false }),
  isElementVisible: jest.fn().mockReturnValue(true),
  resolveSelector: jest.fn((selector: string) => selector),
}));

describe('HoverHandler', () => {
  let hoverHandler: HoverHandler;
  let mockStateManager: jest.Mocked<InteractiveStateManager>;
  let mockNavigationManager: jest.Mocked<NavigationManager>;
  let mockWaitForReactUpdates: jest.Mock;

  // Helper to create mock elements
  const createMockElement = () => {
    const element = document.createElement('div');
    element.textContent = 'Hover Target';
    element.getBoundingClientRect = jest.fn().mockReturnValue({
      left: 100,
      top: 100,
      right: 200,
      bottom: 200,
      width: 100,
      height: 100,
    });
    return element;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mocks
    mockStateManager = new InteractiveStateManager() as jest.Mocked<InteractiveStateManager>;
    mockStateManager.setState = jest.fn();
    mockStateManager.handleError = jest.fn();

    mockNavigationManager = new NavigationManager() as jest.Mocked<NavigationManager>;
    mockNavigationManager.ensureNavigationOpen = jest.fn().mockResolvedValue(undefined);
    mockNavigationManager.ensureElementVisible = jest.fn().mockResolvedValue(undefined);
    mockNavigationManager.highlightWithComment = jest.fn().mockResolvedValue(undefined);
    mockNavigationManager.clearAllHighlights = jest.fn();

    mockWaitForReactUpdates = jest.fn().mockResolvedValue(undefined);

    hoverHandler = new HoverHandler(mockStateManager, mockNavigationManager, mockWaitForReactUpdates);
  });

  describe('execute', () => {
    it('should set state to running and then completed', async () => {
      const { querySelectorAllEnhanced } = require('../../lib/dom');
      const mockElement = createMockElement();
      querySelectorAllEnhanced.mockReturnValue({ elements: [mockElement] });

      const data: InteractiveElementData = {
        reftarget: '#test',
        targetaction: 'hover',
        tagName: 'div',
        textContent: 'Test',
        timestamp: Date.now(),
      };

      await hoverHandler.execute(data, true);

      expect(mockStateManager.setState).toHaveBeenCalledWith(data, 'running');
      expect(mockStateManager.setState).toHaveBeenCalledWith(data, 'completed');
    }, 10000); // Extended timeout for real timers

    it('should handle show mode (performHover = false)', async () => {
      const { querySelectorAllEnhanced } = require('../../lib/dom');
      const mockElement = createMockElement();
      querySelectorAllEnhanced.mockReturnValue({ elements: [mockElement] });

      const data: InteractiveElementData = {
        reftarget: '#test',
        targetaction: 'hover',
        targetcomment: 'Hover over this element',
        tagName: 'div',
        textContent: 'Test',
        timestamp: Date.now(),
      };

      await hoverHandler.execute(data, false);

      expect(mockNavigationManager.highlightWithComment).toHaveBeenCalledWith(mockElement, 'Hover over this element');
      expect(mockNavigationManager.clearAllHighlights).not.toHaveBeenCalled();
    }, 10000);

    it('should handle do mode (performHover = true)', async () => {
      const { querySelectorAllEnhanced } = require('../../lib/dom');
      const mockElement = createMockElement();
      querySelectorAllEnhanced.mockReturnValue({ elements: [mockElement] });

      const data: InteractiveElementData = {
        reftarget: '#test',
        targetaction: 'hover',
        tagName: 'div',
        textContent: 'Test',
        timestamp: Date.now(),
      };

      await hoverHandler.execute(data, true);

      expect(mockNavigationManager.clearAllHighlights).toHaveBeenCalled();
    }, 10000);

    it('should handle errors gracefully', async () => {
      const { querySelectorAllEnhanced } = require('../../lib/dom');
      querySelectorAllEnhanced.mockReturnValue({ elements: [] });

      const data: InteractiveElementData = {
        reftarget: '#non-existent',
        targetaction: 'hover',
        tagName: 'div',
        textContent: 'Test',
        timestamp: Date.now(),
      };

      await hoverHandler.execute(data, true);

      expect(mockStateManager.handleError).toHaveBeenCalled();
    });
  });

  describe('hover state application', () => {
    it('should apply programmatic hover state with data attribute', async () => {
      const { querySelectorAllEnhanced } = require('../../lib/dom');
      const mockElement = createMockElement();
      querySelectorAllEnhanced.mockReturnValue({ elements: [mockElement] });

      const data: InteractiveElementData = {
        reftarget: '#test',
        targetaction: 'hover',
        tagName: 'div',
        textContent: 'Test',
        timestamp: Date.now(),
      };

      await hoverHandler.execute(data, true);

      expect(mockElement.getAttribute('data-interactive-hover')).toBe('true');
    }, 10000);

    it('should handle group-hover Tailwind classes', async () => {
      const { querySelectorAllEnhanced } = require('../../lib/dom');
      const mockElement = createMockElement();

      // Create child element with group-hover class
      const childElement = document.createElement('span');
      childElement.classList.add('group-hover:flex', 'hidden');
      mockElement.appendChild(childElement);

      querySelectorAllEnhanced.mockReturnValue({ elements: [mockElement] });

      const data: InteractiveElementData = {
        reftarget: '#test',
        targetaction: 'hover',
        tagName: 'div',
        textContent: 'Test',
        timestamp: Date.now(),
      };

      await hoverHandler.execute(data, true);

      // Should have applied the hover class
      expect(childElement.classList.contains('flex')).toBe(true);
      // Should have removed the conflicting hidden class
      expect(childElement.classList.contains('hidden')).toBe(false);
      // Should track the added class
      expect(childElement.getAttribute('data-interactive-added-classes')).toContain('flex');
      // Should track that hidden was removed
      expect(childElement.getAttribute('data-interactive-removed-hidden')).toBe('true');
    }, 10000);

    it('should dispatch hover events', async () => {
      const { querySelectorAllEnhanced } = require('../../lib/dom');
      const mockElement = createMockElement();
      const eventsSpy = jest.fn();
      mockElement.addEventListener('mouseenter', eventsSpy);
      mockElement.addEventListener('mouseover', eventsSpy);
      mockElement.addEventListener('mousemove', eventsSpy);

      querySelectorAllEnhanced.mockReturnValue({ elements: [mockElement] });

      const data: InteractiveElementData = {
        reftarget: '#test',
        targetaction: 'hover',
        tagName: 'div',
        textContent: 'Test',
        timestamp: Date.now(),
      };

      await hoverHandler.execute(data, true);

      // Should have dispatched all three events
      expect(eventsSpy).toHaveBeenCalledTimes(3);
    }, 10000);
  });

  describe('element visibility', () => {
    it('should warn but continue when element is not visible', async () => {
      const { querySelectorAllEnhanced, isElementVisible } = require('../../lib/dom');
      const mockElement = createMockElement();
      querySelectorAllEnhanced.mockReturnValue({ elements: [mockElement] });
      isElementVisible.mockReturnValue(false);

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const data: InteractiveElementData = {
        reftarget: '#hidden-element',
        targetaction: 'hover',
        tagName: 'div',
        textContent: 'Test',
        timestamp: Date.now(),
      };

      await hoverHandler.execute(data, true);

      expect(consoleSpy).toHaveBeenCalledWith('Target element is not visible:', mockElement);
      expect(mockStateManager.setState).toHaveBeenCalledWith(data, 'completed');

      consoleSpy.mockRestore();
    }, 10000);
  });

  describe('focusable elements', () => {
    it('should focus focusable elements during hover', async () => {
      const { querySelectorAllEnhanced } = require('../../lib/dom');
      const mockButton = document.createElement('button');
      mockButton.getBoundingClientRect = jest.fn().mockReturnValue({
        left: 100,
        top: 100,
        right: 200,
        bottom: 200,
        width: 100,
        height: 100,
      });
      const focusSpy = jest.spyOn(mockButton, 'focus');

      querySelectorAllEnhanced.mockReturnValue({ elements: [mockButton] });

      const data: InteractiveElementData = {
        reftarget: 'button#test',
        targetaction: 'hover',
        tagName: 'button',
        textContent: 'Test',
        timestamp: Date.now(),
      };

      await hoverHandler.execute(data, true);

      expect(focusSpy).toHaveBeenCalled();
    }, 10000);

    it('should handle focus errors gracefully', async () => {
      const { querySelectorAllEnhanced } = require('../../lib/dom');
      const mockElement = createMockElement();
      mockElement.setAttribute('tabindex', '0');
      mockElement.focus = jest.fn().mockImplementation(() => {
        throw new Error('Cannot focus');
      });

      querySelectorAllEnhanced.mockReturnValue({ elements: [mockElement] });

      const data: InteractiveElementData = {
        reftarget: '#test',
        targetaction: 'hover',
        tagName: 'div',
        textContent: 'Test',
        timestamp: Date.now(),
      };

      // Should not throw
      await expect(hoverHandler.execute(data, true)).resolves.toBeUndefined();
      expect(mockStateManager.setState).toHaveBeenCalledWith(data, 'completed');
    }, 10000);
  });

  describe('navigation and visibility preparation', () => {
    it('should ensure navigation is open before hover', async () => {
      const { querySelectorAllEnhanced } = require('../../lib/dom');
      const mockElement = createMockElement();
      querySelectorAllEnhanced.mockReturnValue({ elements: [mockElement] });

      const data: InteractiveElementData = {
        reftarget: '#nav-element',
        targetaction: 'hover',
        tagName: 'div',
        textContent: 'Test',
        timestamp: Date.now(),
      };

      await hoverHandler.execute(data, true);

      expect(mockNavigationManager.ensureNavigationOpen).toHaveBeenCalledWith(mockElement);
      expect(mockNavigationManager.ensureElementVisible).toHaveBeenCalledWith(mockElement);
    }, 10000);
  });

  describe('multiple elements', () => {
    it('should warn and use first element when multiple match', async () => {
      const { querySelectorAllEnhanced } = require('../../lib/dom');
      const mockElement1 = createMockElement();
      const mockElement2 = createMockElement();
      querySelectorAllEnhanced.mockReturnValue({ elements: [mockElement1, mockElement2] });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const data: InteractiveElementData = {
        reftarget: '.test-class',
        targetaction: 'hover',
        tagName: 'div',
        textContent: 'Test',
        timestamp: Date.now(),
      };

      await hoverHandler.execute(data, true);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Multiple elements found'));
      // Should use first element - verify by checking data attribute was set
      expect(mockElement1.getAttribute('data-interactive-hover')).toBe('true');

      consoleSpy.mockRestore();
    }, 10000);
  });
});
