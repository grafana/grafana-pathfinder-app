/**
 * Tests for selector generator utility wrapper
 * Focuses on integration behavior rather than implementation details
 */

import { generateSelectorFromEvent } from './selector-generator.util';
import * as domUtils from '../../lib/dom';
import * as actionDetector from '../../interactive-engine/auto-completion/action-detector';

// Mock console methods to avoid noise in tests
const originalConsoleWarn = console.warn;

beforeEach(() => {
  console.warn = jest.fn();
  jest.clearAllMocks();
});

afterEach(() => {
  console.warn = originalConsoleWarn;
});

// Mock DOM utilities
jest.mock('../../lib/dom', () => ({
  generateBestSelector: jest.fn(),
  getSelectorInfo: jest.fn(),
  validateAndCleanSelector: jest.fn(),
}));

// Mock action detector
jest.mock('../../interactive-engine/auto-completion/action-detector', () => ({
  detectActionType: jest.fn(),
}));

describe('generateSelectorFromEvent', () => {
  let mockElement: HTMLElement;
  let mockMouseEvent: MouseEvent;
  let mockEvent: Event;

  beforeEach(() => {
    mockElement = document.createElement('button');
    mockElement.setAttribute('data-testid', 'save-button');
    mockElement.textContent = 'Save';

    mockMouseEvent = {
      type: 'click',
      clientX: 100,
      clientY: 200,
      target: mockElement,
    } as unknown as MouseEvent;

    mockEvent = {
      type: 'change',
      target: mockElement,
    } as unknown as Event;

    // Default mock implementations
    (domUtils.generateBestSelector as jest.Mock).mockReturnValue('button[data-testid="save-button"]');
    (domUtils.getSelectorInfo as jest.Mock).mockReturnValue({
      method: 'data-testid',
      isUnique: true,
      matchCount: 1,
      contextStrategy: undefined,
    });
    (domUtils.validateAndCleanSelector as jest.Mock).mockReturnValue({
      selector: 'button[data-testid="save-button"]',
      action: 'highlight',
      warnings: [],
      wasModified: false,
    });
    (actionDetector.detectActionType as jest.Mock).mockReturnValue('highlight');
  });

  describe('Coordinate extraction', () => {
    it('should extract coordinates from MouseEvent', () => {
      const result = generateSelectorFromEvent(mockElement, mockMouseEvent);

      // Verify coordinates are passed to generateBestSelector
      expect(domUtils.generateBestSelector).toHaveBeenCalledWith(mockElement, { clickX: 100, clickY: 200 });
      expect(result.selector).toBe('button[data-testid="save-button"]');
    });

    it('should not pass coordinates for non-MouseEvent', () => {
      const result = generateSelectorFromEvent(mockElement, mockEvent);

      // Should not pass coordinates
      expect(domUtils.generateBestSelector).toHaveBeenCalledWith(mockElement, undefined);
      expect(result.selector).toBe('button[data-testid="save-button"]');
    });
  });

  describe('Action normalization', () => {
    it('should normalize plain text selector to button action', () => {
      (domUtils.generateBestSelector as jest.Mock).mockReturnValue('Save');
      (actionDetector.detectActionType as jest.Mock).mockReturnValue('highlight');
      (domUtils.validateAndCleanSelector as jest.Mock).mockReturnValue({
        selector: 'Save',
        action: 'button',
        warnings: [],
        wasModified: false,
      });

      const result = generateSelectorFromEvent(mockElement, mockMouseEvent);

      expect(result.action).toBe('button');
      expect(result.selector).toBe('Save');
    });

    it('should normalize button action with CSS selector to highlight', () => {
      (actionDetector.detectActionType as jest.Mock).mockReturnValue('button');
      (domUtils.validateAndCleanSelector as jest.Mock).mockReturnValue({
        selector: 'button[data-testid="save"]',
        action: 'highlight',
        warnings: [],
        wasModified: false,
      });

      const result = generateSelectorFromEvent(mockElement, mockMouseEvent);

      expect(result.action).toBe('highlight');
    });
  });

  describe('Warning propagation', () => {
    it('should include validation warnings in result', () => {
      (domUtils.validateAndCleanSelector as jest.Mock).mockReturnValue({
        selector: 'button[data-testid="save"]',
        action: 'highlight',
        warnings: ['Removed auto-generated class', 'Cleaned whitespace'],
        wasModified: true,
      });

      const result = generateSelectorFromEvent(mockElement, mockMouseEvent);

      expect(result.warnings).toEqual(['Removed auto-generated class', 'Cleaned whitespace']);
    });

    it('should use cleaned selector from validation', () => {
      (domUtils.generateBestSelector as jest.Mock).mockReturnValue('button.css-abc123');
      (domUtils.validateAndCleanSelector as jest.Mock).mockReturnValue({
        selector: 'button',
        action: 'highlight',
        warnings: ['Removed auto-generated class'],
        wasModified: true,
      });

      const result = generateSelectorFromEvent(mockElement, mockMouseEvent);

      expect(result.selector).toBe('button');
      expect(result.warnings).toContain('Removed auto-generated class');
    });
  });

  describe('Event type handling', () => {
    it('should handle click events', () => {
      const result = generateSelectorFromEvent(mockElement, mockMouseEvent);

      expect(result.selector).toBeTruthy();
      expect(result.action).toBeTruthy();
    });

    it('should handle change events', () => {
      const result = generateSelectorFromEvent(mockElement, mockEvent);

      expect(result.selector).toBeTruthy();
      expect(result.action).toBeTruthy();
    });

    it('should handle input events', () => {
      const inputEvent = {
        type: 'input',
        target: mockElement,
      } as unknown as Event;

      const result = generateSelectorFromEvent(mockElement, inputEvent);

      expect(result.selector).toBeTruthy();
      expect(result.action).toBeTruthy();
    });
  });

  describe('Action validation', () => {
    it('should use validated action if it is a valid DetectedAction', () => {
      (domUtils.validateAndCleanSelector as jest.Mock).mockReturnValue({
        selector: 'input[name="query"]',
        action: 'formfill',
        warnings: [],
        wasModified: false,
      });
      (actionDetector.detectActionType as jest.Mock).mockReturnValue('button');

      const result = generateSelectorFromEvent(mockElement, mockMouseEvent);

      expect(result.action).toBe('formfill');
    });

    it('should keep original action if validated action is invalid', () => {
      (actionDetector.detectActionType as jest.Mock).mockReturnValue('formfill');
      (domUtils.validateAndCleanSelector as jest.Mock).mockReturnValue({
        selector: 'button[data-testid="save"]',
        action: 'invalid-action' as any,
        warnings: [],
        wasModified: false,
      });

      const result = generateSelectorFromEvent(mockElement, mockMouseEvent);

      // Should keep the original detected action since validated action is invalid
      expect(result.action).toBe('formfill');
    });
  });

  describe('Selector info', () => {
    it('should include selector info in result', () => {
      (domUtils.getSelectorInfo as jest.Mock).mockReturnValue({
        method: 'data-testid',
        isUnique: false,
        matchCount: 3,
        contextStrategy: 'parent-context',
      });

      const result = generateSelectorFromEvent(mockElement, mockMouseEvent);

      expect(result.selectorInfo).toEqual({
        method: 'data-testid',
        isUnique: false,
        matchCount: 3,
        contextStrategy: 'parent-context',
      });
    });
  });
});

