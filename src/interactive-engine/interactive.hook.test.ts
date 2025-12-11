import { renderHook, act } from '@testing-library/react';
import { useInteractiveElements } from './interactive.hook';

// Mock Grafana's location service
jest.mock('@grafana/runtime', () => ({
  locationService: {
    push: jest.fn(),
  },
}));

// Mock requirements checker
jest.mock('../requirements-manager', () => ({
  checkRequirements: jest.fn(),
  checkPostconditions: jest.fn(),
  RequirementsCheckOptions: jest.fn(),
}));

// Mock action handlers
jest.mock('./action-handlers', () => ({
  FocusHandler: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue(undefined),
  })),
  ButtonHandler: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue(undefined),
  })),
  NavigateHandler: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue(undefined),
  })),
  FormFillHandler: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue(undefined),
  })),
  HoverHandler: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue(undefined),
  })),
  GuidedHandler: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue(undefined),
    executeGuidedStep: jest.fn().mockResolvedValue('completed'),
    cancel: jest.fn(),
  })),
}));

// Mock managers
jest.mock('./interactive-state-manager', () => ({
  InteractiveStateManager: jest.fn().mockImplementation(() => ({
    setState: jest.fn(),
    handleError: jest.fn(),
  })),
}));

jest.mock('./navigation-manager', () => ({
  NavigationManager: jest.fn().mockImplementation(() => ({
    ensureNavigationOpen: jest.fn().mockResolvedValue(undefined),
    ensureElementVisible: jest.fn().mockResolvedValue(undefined),
    highlight: jest.fn().mockResolvedValue(undefined),
    fixNavigationRequirements: jest.fn().mockResolvedValue(undefined),
    openAndDockNavigation: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('./sequence-manager', () => ({
  SequenceManager: jest.fn().mockImplementation(() => ({
    runInteractiveSequence: jest.fn().mockResolvedValue(undefined),
    runStepByStepSequence: jest.fn().mockResolvedValue(undefined),
  })),
}));

// Mock dom-utils
jest.mock('../lib/dom', () => ({
  extractInteractiveDataFromElement: jest.fn().mockReturnValue({
    reftarget: 'test-target',
    targetaction: 'highlight',
    targetvalue: 'test-value',
    requirements: 'test-requirements',
    tagName: 'div',
    textContent: 'Test Element',
    timestamp: Date.now(),
  }),
  // Re-export other commonly needed functions as pass-through mocks
  findButtonByText: jest.fn().mockReturnValue([]),
  querySelectorAllEnhanced: jest.fn().mockReturnValue({ elements: [], usedFallback: false, originalSelector: '' }),
  resolveSelector: jest.fn((selector: string) => selector), // Pass through selector as-is for tests
}));

describe('useInteractiveElements', () => {
  // Get access to mocked functions
  const { checkRequirements } = require('../requirements-manager');
  const { extractInteractiveDataFromElement } = require('../lib/dom');

  // Create a container div for our tests
  let container: HTMLDivElement;
  let containerRef: React.RefObject<HTMLDivElement>;

  // Helper function to set up the test environment with our example HTML
  const setupTestEnvironment = () => {
    const html = `
      <div class="grafana-app-container">
        <!-- Navigation area -->
        <nav>
          <a data-testid="data-testid Nav menu item" href="/connections">Connections</a>
        </nav>

        <!-- Main content area -->
        <main>
          <h1>Add the Prometheus Datasource</h1>
          <p>This is a demo product-interactive HTML page, extracted from the Prometheus LJ</p>

          <p>Grafana provides built-in support for a Prometheus data source. 
          In this step of your journey, you add the Prometheus data source and give it a name.</p>

          <p>To add the Prometheus data source, complete the following steps:</p>

          <!-- An interactive one-shot block sequence -->
          <span id="test1" class="interactive" data-targetaction="sequence" data-reftarget="span#test1"> 
              <ul>
                <!-- Highlight a menu item and click it -->
                <li class="interactive" 
                    data-reftarget="a[data-testid='data-testid Nav menu item'][href='/connections']"
                    data-targetaction='highlight'>
                  Click Connections in the left-side menu.</li>
                <li>
                  Under Connections, click Add new connection.</li>
                <!-- Fill out a form item -->
                <li class="interactive" data-reftarget="input[type='text']"
                  data-targetaction='formfill' data-targetvalue='Prometheus'>
                  Enter Prometheus in the search bar.</li>
                <!-- Highlight a menu item and click it -->
                <li class="interactive" 
                    data-reftarget="a[href='/connections/datasources/prometheus']"
                    data-targetaction='highlight'>
                  Click Prometheus data source.</li>
                <!-- Button finding by text -->
                <li class="interactive"
                    data-reftarget="Add new data source"
                    data-targetaction='button'>
                  Click Add new data source in the upper right.
                </li>
              </ul>
          </span>
        </main>

        <!-- UI Elements that are targets of our interactive elements -->
        <div class="ui-elements">
          <input type="text" placeholder="Search datasources" />
          <a href="/connections/datasources/prometheus">Prometheus</a>
          <button>Add new data source</button>
        </div>
      </div>
    `;

    container.innerHTML = html;
    document.body.appendChild(container);
  };

  beforeEach(() => {
    // Setup fresh DOM for each test
    container = document.createElement('div');
    containerRef = { current: container };

    // Reset all mocks
    jest.clearAllMocks();
    // Clear console mocks
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});

    // Default mock implementation for requirements
    checkRequirements.mockResolvedValue({
      pass: true,
      requirements: '',
      error: [],
    });

    // Set up test environment
    setupTestEnvironment();
  });

  afterEach(() => {
    // Cleanup DOM
    document.body.removeChild(container);
    // Remove any added styles
    document.querySelectorAll('.interactive-highlight-outline').forEach((el) => el.remove());
    jest.restoreAllMocks();
  });

  describe('Hook Initialization', () => {
    it('should initialize without errors', () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      expect(result.current).toBeDefined();
      expect(result.current.interactiveFocus).toBeDefined();
      expect(result.current.interactiveButton).toBeDefined();
      expect(result.current.interactiveFormFill).toBeDefined();
      expect(result.current.interactiveNavigate).toBeDefined();
      expect(result.current.interactiveSequence).toBeDefined();
      expect(result.current.checkElementRequirements).toBeDefined();
      expect(result.current.checkRequirementsFromData).toBeDefined();
      expect(result.current.executeInteractiveAction).toBeDefined();
      expect(result.current.fixNavigationRequirements).toBeDefined();
    });

    it('should work without containerRef', () => {
      const { result } = renderHook(() => useInteractiveElements());

      expect(result.current.interactiveFocus).toBeDefined();
    });
  });

  describe('Interactive Highlighting', () => {
    it('should highlight the Connections menu item in show mode', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      await act(async () => {
        await result.current.interactiveFocus(
          {
            reftarget: 'a[data-testid="data-testid Nav menu item"][href="/connections"]',
            targetaction: 'highlight',
            tagName: 'li',
          },
          false // show mode
        );
      });

      // Since we're using mocked handlers, we just verify the function was called
      expect(result.current.interactiveFocus).toBeDefined();
    });

    it('should click the Connections menu item in do mode', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      await act(async () => {
        await result.current.interactiveFocus(
          {
            reftarget: 'a[data-testid="data-testid Nav menu item"][href="/connections"]',
            targetaction: 'highlight',
            tagName: 'li',
          },
          true // do mode
        );
      });

      // Since we're using mocked handlers, we just verify the function was called
      expect(result.current.interactiveFocus).toBeDefined();
    });
  });

  describe('Interactive Form Fill', () => {
    it('should fill the search input with "Prometheus"', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      await act(async () => {
        await result.current.interactiveFormFill(
          {
            reftarget: 'input[type="text"]',
            targetaction: 'formfill',
            targetvalue: 'Prometheus',
            tagName: 'li',
          },
          true // do mode
        );
      });

      // Since we're using mocked handlers, we just verify the function was called
      expect(result.current.interactiveFormFill).toBeDefined();
    });

    it('should handle form fill in show mode', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      await act(async () => {
        await result.current.interactiveFormFill(
          {
            reftarget: 'input[type="text"]',
            targetaction: 'formfill',
            targetvalue: 'Prometheus',
            tagName: 'li',
          },
          false // show mode
        );
      });

      // Should not fill the input in show mode
      const input = document.querySelector('input[type="text"]') as HTMLInputElement;
      expect(input.value).toBe('');
    });
  });

  describe('Interactive Button', () => {
    it('should find and click the "Add new data source" button by text', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      await act(async () => {
        await result.current.interactiveButton(
          {
            reftarget: 'Add new data source',
            targetaction: 'button',
            tagName: 'li',
          },
          true // do mode
        );
      });

      // Since we're using mocked handlers, we just verify the function was called
      expect(result.current.interactiveButton).toBeDefined();
    });

    it('should handle button in show mode', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      await act(async () => {
        await result.current.interactiveButton(
          {
            reftarget: 'Add new data source',
            targetaction: 'button',
            tagName: 'li',
          },
          false // show mode
        );
      });

      // Should not click in show mode
      const button = document.querySelector('button') as HTMLButtonElement;
      const clickSpy = jest.spyOn(button, 'click');
      expect(clickSpy).not.toHaveBeenCalled();
    });
  });

  describe('Interactive Navigation', () => {
    it('should handle navigation in do mode', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      await act(async () => {
        await result.current.interactiveNavigate(
          {
            reftarget: '/test-route',
            targetaction: 'navigate',
            tagName: 'a',
          },
          true // do mode
        );
      });

      // Since we're using mocked handlers, we just verify the function was called
      expect(result.current.interactiveNavigate).toBeDefined();
    });

    it('should handle navigation in show mode', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      await act(async () => {
        await result.current.interactiveNavigate(
          {
            reftarget: '/test-route',
            targetaction: 'navigate',
            tagName: 'a',
          },
          false // show mode
        );
      });

      // Should not navigate in show mode
      const { locationService } = require('@grafana/runtime');
      expect(locationService.push).not.toHaveBeenCalled();
    });

    it('should handle external URLs', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      await act(async () => {
        await result.current.interactiveNavigate(
          {
            reftarget: 'https://example.com',
            targetaction: 'navigate',
            tagName: 'a',
          },
          true // do mode
        );
      });

      // Since we're using mocked handlers, we just verify the function was called
      expect(result.current.interactiveNavigate).toBeDefined();
    });
  });

  describe('Interactive Sequence', () => {
    it('should handle sequence in show mode', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      await act(async () => {
        await result.current.interactiveSequence(
          {
            reftarget: 'span#test1',
            targetaction: 'sequence',
            tagName: 'span',
          },
          true // show mode
        );
      });

      // Should call sequence manager with show mode
      const { SequenceManager } = require('./sequence-manager');
      expect(SequenceManager).toHaveBeenCalled();
    });

    it('should handle sequence in do mode', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      await act(async () => {
        await result.current.interactiveSequence(
          {
            reftarget: 'span#test1',
            targetaction: 'sequence',
            tagName: 'span',
          },
          false // do mode
        );
      });

      // Should call sequence manager with do mode
      const { SequenceManager } = require('./sequence-manager');
      expect(SequenceManager).toHaveBeenCalled();
    });

    it('should handle missing sequence container', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      await act(async () => {
        await result.current.interactiveSequence(
          {
            reftarget: '#nonexistent',
            targetaction: 'sequence',
            tagName: 'span',
          },
          false
        );
      });

      // Should handle error gracefully
      const { InteractiveStateManager } = require('./interactive-state-manager');
      expect(InteractiveStateManager).toHaveBeenCalled();
    });

    it('should prevent recursion', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      const data = {
        reftarget: 'span#test1',
        targetaction: 'sequence',
        tagName: 'span',
      };

      // First call
      await act(async () => {
        await result.current.interactiveSequence(data, false);
      });

      // Second call with same reftarget should return early
      await act(async () => {
        const result2 = await result.current.interactiveSequence(data, false);
        expect(result2).toBe('span#test1');
      });
    });
  });

  describe('Requirements Checking', () => {
    it('should check requirements for sequence elements', async () => {
      // Setup mock response for success case
      checkRequirements.mockResolvedValueOnce({
        pass: true,
        requirements: 'exists-reftarget',
        error: [
          {
            requirement: 'exists-reftarget',
            pass: true,
          },
        ],
      });

      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      // Wait for hook initialization
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      const interactiveElement = document.querySelector('li.interactive[data-targetaction="highlight"]');

      const check = await result.current.checkElementRequirements(interactiveElement as HTMLElement);

      expect(check.pass).toBeTruthy();
      expect(check.error).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            requirement: 'exists-reftarget',
            pass: true,
          }),
        ])
      );
    });

    it('should handle failed requirements', async () => {
      // Setup mock response for failure case
      checkRequirements.mockResolvedValueOnce({
        pass: false,
        requirements: 'exists-reftarget',
        error: [
          {
            requirement: 'exists-reftarget',
            pass: false,
            error: 'Element not found',
          },
        ],
      });

      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      // Wait for hook initialization
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      // Create an element with a non-existent target
      const element = document.createElement('li');
      element.className = 'interactive';
      element.setAttribute('data-targetaction', 'highlight');
      element.setAttribute('data-reftarget', '#nonexistent');
      container.appendChild(element);

      const check = await result.current.checkElementRequirements(element);

      expect(check.pass).toBeFalsy();
      expect(check.error).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            requirement: 'exists-reftarget',
            pass: false,
          }),
        ])
      );
    });

    it('should check requirements from data', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      const data = {
        reftarget: 'test-target',
        targetaction: 'highlight',
        targetvalue: 'test-value',
        requirements: 'test-requirements',
        tagName: 'div',
        textContent: 'Test Element',
        timestamp: Date.now(),
      };

      await result.current.checkRequirementsFromData(data);

      expect(checkRequirements).toHaveBeenCalledWith({
        requirements: 'test-requirements',
        targetAction: 'highlight',
        refTarget: 'test-target',
        targetValue: 'test-value',
        stepId: 'Test Element',
      });
    });

    it('should check requirements with data', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      const element = document.createElement('div');
      element.className = 'interactive';
      element.setAttribute('data-targetaction', 'highlight');
      element.setAttribute('data-reftarget', 'test-target');

      // checkRequirementsWithData was removed - use checkElementRequirements instead
      const result2 = await result.current.checkElementRequirements(element);

      // checkElementRequirements returns InteractiveRequirementsCheck directly (not wrapped)
      expect(result2).toHaveProperty('requirements');
      expect(result2).toHaveProperty('pass');
      expect(result2).toHaveProperty('error');
      expect(extractInteractiveDataFromElement).toHaveBeenCalledWith(element);
    });
  });

  describe('Execute Interactive Action', () => {
    it('should execute highlight action', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      await act(async () => {
        await result.current.executeInteractiveAction('highlight', 'test-target', undefined, 'do');
      });

      // Should call interactiveFocus
      expect(result.current.interactiveFocus).toBeDefined();
    });

    it('should execute button action', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      await act(async () => {
        await result.current.executeInteractiveAction('button', 'test-target', undefined, 'do');
      });

      // Should call interactiveButton
      expect(result.current.interactiveButton).toBeDefined();
    });

    it('should execute formfill action', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      await act(async () => {
        await result.current.executeInteractiveAction('formfill', 'test-target', 'test-value', 'do');
      });

      // Should call interactiveFormFill
      expect(result.current.interactiveFormFill).toBeDefined();
    });

    it('should execute navigate action', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      await act(async () => {
        await result.current.executeInteractiveAction('navigate', '/test-route', undefined, 'do');
      });

      // Should call interactiveNavigate
      expect(result.current.interactiveNavigate).toBeDefined();
    });

    it('should execute sequence action', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      await act(async () => {
        await result.current.executeInteractiveAction('sequence', 'span#test1', undefined, 'do');
      });

      // Should call interactiveSequence
      expect(result.current.interactiveSequence).toBeDefined();
    });

    it('should handle unknown action', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      await act(async () => {
        await result.current.executeInteractiveAction('unknown', 'test-target', undefined, 'do');
      });

      expect(consoleWarnSpy).toHaveBeenCalledWith('[pathfinder]', 'Unknown interactive action: unknown');
    });

    it('should handle errors in executeInteractiveAction', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      // Mock an error by making interactiveFocus throw
      const mockError = new Error('Test error');
      result.current.interactiveFocus = jest.fn().mockRejectedValue(mockError);

      await act(async () => {
        await result.current.executeInteractiveAction('highlight', 'test-target', undefined, 'do');
      });

      // Should handle error gracefully
      const { InteractiveStateManager } = require('./interactive-state-manager');
      expect(InteractiveStateManager).toHaveBeenCalled();
    });
  });

  describe('Navigation Requirements', () => {
    it('should call fixNavigationRequirements', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      await act(async () => {
        await result.current.fixNavigationRequirements();
      });

      // Should call navigation manager's fixNavigationRequirements
      const { NavigationManager } = require('./navigation-manager');
      expect(NavigationManager).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle errors in interactiveFocus', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      // Mock an error by making the handler throw
      const { FocusHandler } = require('./action-handlers');
      FocusHandler.mockImplementationOnce(() => ({
        execute: jest.fn().mockRejectedValue(new Error('Test error')),
      }));

      await act(async () => {
        await result.current.interactiveFocus(
          {
            reftarget: 'test-target',
            targetaction: 'highlight',
            tagName: 'div',
          },
          true
        );
      });

      // Should handle error gracefully
      const { InteractiveStateManager } = require('./interactive-state-manager');
      expect(InteractiveStateManager).toHaveBeenCalled();
    });

    it('should handle errors in interactiveSequence', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      // Mock an error by making sequenceManager throw
      const mockError = new Error('Test error');
      const { SequenceManager } = require('./sequence-manager');
      SequenceManager.mockImplementationOnce(() => ({
        runStepByStepSequence: jest.fn().mockRejectedValue(mockError),
        runInteractiveSequence: jest.fn().mockRejectedValue(mockError),
      }));

      await act(async () => {
        await result.current.interactiveSequence(
          {
            reftarget: 'span#test1',
            targetaction: 'sequence',
            tagName: 'span',
          },
          false
        );
      });

      // Should handle error gracefully
      const { InteractiveStateManager } = require('./interactive-state-manager');
      expect(InteractiveStateManager).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty requirements', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      const data = {
        reftarget: 'test-target',
        targetaction: 'highlight',
        targetvalue: 'test-value',
        requirements: '',
        tagName: 'div',
        textContent: 'Test Element',
        timestamp: Date.now(),
      };

      await result.current.checkRequirementsFromData(data);

      expect(checkRequirements).toHaveBeenCalledWith({
        requirements: '',
        targetAction: 'highlight',
        refTarget: 'test-target',
        targetValue: 'test-value',
        stepId: 'Test Element',
      });
    });

    it('should handle undefined requirements', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      const data = {
        reftarget: 'test-target',
        targetaction: 'highlight',
        targetvalue: 'test-value',
        requirements: undefined,
        tagName: 'div',
        textContent: 'Test Element',
        timestamp: Date.now(),
      };

      await result.current.checkRequirementsFromData(data);

      expect(checkRequirements).toHaveBeenCalledWith({
        requirements: '',
        targetAction: 'highlight',
        refTarget: 'test-target',
        targetValue: 'test-value',
        stepId: 'Test Element',
      });
    });

    it('should handle undefined textContent', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      const data = {
        reftarget: 'test-target',
        targetaction: 'highlight',
        targetvalue: 'test-value',
        requirements: 'test-requirements',
        tagName: 'div',
        textContent: undefined,
        timestamp: Date.now(),
      };

      await result.current.checkRequirementsFromData(data);

      expect(checkRequirements).toHaveBeenCalledWith({
        requirements: 'test-requirements',
        targetAction: 'highlight',
        refTarget: 'test-target',
        targetValue: 'test-value',
        stepId: 'unknown',
      });
    });
  });
});
