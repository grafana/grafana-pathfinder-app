import { NavigationManager } from './navigation-manager';

// Mock DOM elements
const mockElement = {
  getBoundingClientRect: jest.fn(() => ({
    top: 0,
    left: 0,
    bottom: 100,
    right: 100,
    width: 100,
    height: 100
  })),
  scrollIntoView: jest.fn(),
  classList: {
    add: jest.fn(),
    remove: jest.fn()
  },
  closest: jest.fn(() => null)
} as unknown as HTMLElement;

const mockMegaMenuToggle = {
  getAttribute: jest.fn(() => 'false'),
  click: jest.fn()
} as unknown as HTMLButtonElement;

const mockDockMenuButton = {
  click: jest.fn()
} as unknown as HTMLButtonElement;

// Mock document methods
Object.defineProperty(window, 'innerHeight', { value: 800, writable: true });
Object.defineProperty(window, 'innerWidth', { value: 1200, writable: true });
Object.defineProperty(window, 'scrollY', { value: 0, writable: true });
Object.defineProperty(window, 'scrollX', { value: 0, writable: true });

// Mock document.querySelector
document.querySelector = jest.fn((selector: string) => {
  if (selector === '#mega-menu-toggle') {
    return mockMegaMenuToggle;
  }
  if (selector === '#dock-menu-button') {
    return mockDockMenuButton;
  }
  return null;
});

// Mock document.createElement
document.createElement = jest.fn(() => ({
  className: '',
  style: {
    setProperty: jest.fn()
  }
} as unknown as HTMLElement));

// Mock document.body.appendChild
document.body.appendChild = jest.fn();

describe('NavigationManager', () => {
  let navigationManager: NavigationManager;

  beforeEach(() => {
    navigationManager = new NavigationManager();
    jest.clearAllMocks();
  });

  describe('ensureElementVisible', () => {
    it('should scroll element into view when not visible', async () => {
      // Mock element that is not visible
      const element = {
        ...mockElement,
        getBoundingClientRect: jest.fn(() => ({
          top: -100,
          left: -100,
          bottom: 0,
          right: 0,
          width: 100,
          height: 100
        }))
      } as unknown as HTMLElement;

      await navigationManager.ensureElementVisible(element);

      expect(element.scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'center',
        inline: 'center'
      });
    });

    it('should not scroll element when already visible', async () => {
      await navigationManager.ensureElementVisible(mockElement);

      expect(mockElement.scrollIntoView).not.toHaveBeenCalled();
    });
  });

  describe('highlight', () => {
    it('should add highlight class and create outline element', async () => {
      await navigationManager.highlight(mockElement);

      expect(mockElement.classList.add).toHaveBeenCalledWith('interactive-highlighted');
      expect(document.createElement).toHaveBeenCalledWith('div');
      expect(document.body.appendChild).toHaveBeenCalled();
    });
  });

  describe('ensureNavigationOpen', () => {
    it('should call openAndDockNavigation with correct options', async () => {
      const spy = jest.spyOn(navigationManager, 'openAndDockNavigation');

      await navigationManager.ensureNavigationOpen(mockElement);

      expect(spy).toHaveBeenCalledWith(mockElement, {
        checkContext: true,
        logWarnings: false,
        ensureDocked: true
      });
    });
  });

  describe('fixNavigationRequirements', () => {
    it('should call openAndDockNavigation with correct options', async () => {
      const spy = jest.spyOn(navigationManager, 'openAndDockNavigation');

      await navigationManager.fixNavigationRequirements();

      expect(spy).toHaveBeenCalledWith(undefined, {
        checkContext: false,
        logWarnings: true,
        ensureDocked: true
      });
    });
  });

  describe('openAndDockNavigation', () => {
    it('should handle navigation when menu is closed', async () => {
      await navigationManager.openAndDockNavigation(mockElement, {
        checkContext: false,
        logWarnings: true,
        ensureDocked: true
      });

      expect(mockMegaMenuToggle.click).toHaveBeenCalled();
      expect(mockDockMenuButton.click).toHaveBeenCalled();
    });

    it('should handle navigation when menu is already open', async () => {
      // Mock menu as already open
      (mockMegaMenuToggle.getAttribute as jest.Mock).mockReturnValue('true');

      await navigationManager.openAndDockNavigation(mockElement, {
        checkContext: false,
        logWarnings: true,
        ensureDocked: true
      });

      expect(mockMegaMenuToggle.click).not.toHaveBeenCalled();
      expect(mockDockMenuButton.click).toHaveBeenCalled();
    });

    it('should handle missing mega menu toggle', async () => {
      (document.querySelector as jest.Mock).mockReturnValueOnce(null);

      await navigationManager.openAndDockNavigation(mockElement, {
        checkContext: false,
        logWarnings: true,
        ensureDocked: true
      });

      expect(mockMegaMenuToggle.click).not.toHaveBeenCalled();
    });
  });
}); 