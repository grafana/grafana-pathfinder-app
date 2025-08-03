import { renderHook, act } from '@testing-library/react';
import { useInteractiveElements } from './interactive.hook';

// Mock Grafana's location service
jest.mock('@grafana/runtime', () => ({
  locationService: {
    push: jest.fn(),
  },
}));

// Mock requirements checker
jest.mock('./requirements-checker.utils', () => ({
  checkRequirements: jest.fn(),
  RequirementsCheckOptions: jest.fn(),
  CheckResultError: jest.fn(),
  DOMCheckFunctions: jest.fn(),
}));

describe('useInteractiveElements', () => {
  // Get access to mocked functions
  const { checkRequirements } = require('./requirements-checker.utils');

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

  describe('Interactive Highlighting', () => {
    it('should highlight the Connections menu item in show mode', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      const menuItem = document.querySelector('a[data-testid="data-testid Nav menu item"]');
      const interactiveElement = document.querySelector('li.interactive[data-targetaction="highlight"]');

      await act(async () => {
        await result.current.interactiveFocus(
          {
            reftarget: 'a[data-testid="data-testid Nav menu item"][href="/connections"]',
            targetaction: 'highlight',
            tagName: 'li',
          },
          false, // show mode
          interactiveElement as HTMLElement
        );
      });

      expect(menuItem?.classList.contains('interactive-highlighted')).toBeTruthy();
    });

    it('should click the Connections menu item in do mode', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      const menuItem = document.querySelector('a[data-testid="data-testid Nav menu item"]') as HTMLElement;
      const interactiveElement = document.querySelector('li.interactive[data-targetaction="highlight"]');
      const clickSpy = jest.spyOn(menuItem, 'click');

      await act(async () => {
        await result.current.interactiveFocus(
          {
            reftarget: 'a[data-testid="data-testid Nav menu item"][href="/connections"]',
            targetaction: 'highlight',
            tagName: 'li',
          },
          true, // do mode
          interactiveElement as HTMLElement
        );
      });

      expect(clickSpy).toHaveBeenCalled();
    });
  });

  describe('Interactive Form Fill', () => {
    it('should fill the search input with "Prometheus"', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      const input = document.querySelector('input[type="text"]') as HTMLInputElement;
      const interactiveElement = document.querySelector('li.interactive[data-targetaction="formfill"]');

      await act(async () => {
        await result.current.interactiveFormFill(
          {
            reftarget: 'input[type="text"]',
            targetaction: 'formfill',
            targetvalue: 'Prometheus',
            tagName: 'li',
          },
          true, // do mode
          interactiveElement as HTMLElement
        );
      });

      expect(input.value).toBe('Prometheus');
    });
  });

  describe('Interactive Button', () => {
    it('should find and click the "Add new data source" button by text', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));

      const button = document.querySelector('button') as HTMLButtonElement;
      const interactiveElement = document.querySelector('li.interactive[data-targetaction="button"]');
      const clickSpy = jest.spyOn(button, 'click');

      await act(async () => {
        await result.current.interactiveButton(
          {
            reftarget: 'Add new data source',
            targetaction: 'button',
            tagName: 'li',
          },
          true, // do mode
          interactiveElement as HTMLElement
        );
      });

      expect(clickSpy).toHaveBeenCalled();
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
  });
});
