import { renderHook, act } from '@testing-library/react';
import { useInteractiveElements } from './interactive.hook.ts';
import { locationService } from '@grafana/runtime';

// Mock Grafana's location service
jest.mock('@grafana/runtime', () => ({
  locationService: {
    push: jest.fn(),
  }
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

  beforeEach(() => {
    // Setup fresh DOM for each test
    container = document.createElement('div');
    containerRef = { current: container };
    document.body.appendChild(container);

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
      error: []
    });
  });

  afterEach(() => {
    // Cleanup DOM
    document.body.removeChild(container);
    // Remove any added styles or elements
    document.querySelectorAll('.interactive-highlight-outline').forEach(el => el.remove());
    // Remove any added buttons
    document.querySelectorAll('button').forEach(el => el.remove());
    jest.restoreAllMocks();
  });

  describe('Interactive Focus/Highlight', () => {
    it('should highlight elements in show mode', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));
      
      // Create target element
      const targetElement = document.createElement('button');
      targetElement.setAttribute('data-reftarget', '.target-button');
      targetElement.setAttribute('data-targetaction', 'highlight');
      document.body.appendChild(targetElement);

      // Create element to be highlighted
      const elementToHighlight = document.createElement('button');
      elementToHighlight.className = 'target-button';
      document.body.appendChild(elementToHighlight);

      // Execute highlight action in show mode
      await act(async () => {
        await result.current.interactiveFocus(
          {
            reftarget: '.target-button',
            targetaction: 'highlight',
            tagName: 'button'
          },
          false, // show mode
          targetElement
        );
      });

      // Verify the element was highlighted
      expect(elementToHighlight.classList.contains('interactive-highlighted')).toBeTruthy();
    });

    it('should click elements in do mode', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));
      
      // Create target element with click spy
      const elementToClick = document.createElement('button');
      elementToClick.className = 'target-button';
      document.body.appendChild(elementToClick);
      const clickSpy = jest.spyOn(elementToClick, 'click');

      // Execute highlight action in do mode
      await act(async () => {
        await result.current.interactiveFocus(
          {
            reftarget: '.target-button',
            targetaction: 'highlight',
            tagName: 'button'
          },
          true, // do mode
          elementToClick
        );
      });

      // Verify the element was clicked
      expect(clickSpy).toHaveBeenCalled();
    });
  });

  describe('Interactive Button', () => {
    it('should find and click buttons by text content', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));
      
      // Create button to be clicked
      const buttonToClick = document.createElement('button');
      buttonToClick.textContent = 'Submit Form';
      document.body.appendChild(buttonToClick);
      const clickSpy = jest.spyOn(buttonToClick, 'click');

      // Execute button action
      await act(async () => {
        await result.current.interactiveButton(
          {
            reftarget: 'Submit Form',
            targetaction: 'button',
            tagName: 'button'
          },
          true, // do mode
          buttonToClick
        );
      });

      // Verify the button was clicked
      expect(clickSpy).toHaveBeenCalled();
    });

    it('should handle partial text matches', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));
      
      // Create button with longer text
      const buttonToClick = document.createElement('button');
      const textSpan = document.createElement('span');
      textSpan.textContent = 'Submit Form Now';
      buttonToClick.appendChild(textSpan);
      document.body.appendChild(buttonToClick);
      const clickSpy = jest.spyOn(buttonToClick, 'click');

      // Execute button action with partial text
      await act(async () => {
        await result.current.interactiveButton(
          {
            reftarget: 'Submit Form',
            targetaction: 'button',
            tagName: 'button'
          },
          true, // do mode
        );
      });

      // Wait for any async operations
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify the button was found and clicked
      expect(clickSpy).toHaveBeenCalled();
    });
  });

  describe('Interactive Form Fill', () => {
    it('should fill text inputs', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));
      
      // Create input to be filled
      const input = document.createElement('input');
      input.type = 'text';
      input.id = 'test-input';
      document.body.appendChild(input);

      // Execute form fill action
      await act(async () => {
        await result.current.interactiveFormFill(
          {
            reftarget: '#test-input',
            targetaction: 'formfill',
            targetvalue: 'test value',
            tagName: 'input'
          },
          true, // do mode
          input
        );
      });

      // Verify the input was filled
      expect(input.value).toBe('test value');
    });

    it('should handle checkbox inputs', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));
      
      // Create checkbox
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = 'test-checkbox';
      document.body.appendChild(checkbox);

      // Execute form fill action
      await act(async () => {
        await result.current.interactiveFormFill(
          {
            reftarget: '#test-checkbox',
            targetaction: 'formfill',
            targetvalue: 'true',
            tagName: 'input'
          },
          true, // do mode
          checkbox
        );
      });

      // Verify the checkbox was checked
      expect(checkbox.checked).toBe(true);
    });
  });

  describe('Interactive Navigation', () => {
    it('should handle internal navigation', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));
      
      // Execute navigation action
      await act(async () => {
        result.current.interactiveNavigate(
          {
            reftarget: '/dashboard',
            targetaction: 'navigate',
            tagName: 'a'
          },
          true, // do mode
        );
      });

      // Verify locationService was called
      expect(locationService.push).toHaveBeenCalledWith('/dashboard');
    });

    it('should handle external navigation', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));
      
      // Mock window.open
      const windowOpen = jest.spyOn(window, 'open').mockImplementation();

      // Execute navigation action
      await act(async () => {
        result.current.interactiveNavigate(
          {
            reftarget: 'https://grafana.com',
            targetaction: 'navigate',
            tagName: 'a'
          },
          true, // do mode
        );
      });

      // Verify window.open was called
      expect(windowOpen).toHaveBeenCalledWith(
        'https://grafana.com',
        '_blank',
        'noopener,noreferrer'
      );

      windowOpen.mockRestore();
    });

    it('should show navigation target in show mode', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));
      
      const logSpy = jest.spyOn(console, 'log');

      // Execute navigation action in show mode
      await act(async () => {
        result.current.interactiveNavigate(
          {
            reftarget: '/dashboard',
            targetaction: 'navigate',
            tagName: 'a'
          },
          false, // show mode
        );
      });

      // Verify navigation was only shown, not executed
      expect(locationService.push).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('/dashboard'));
    });
  });

  describe('Interactive Sequence', () => {
    it('should execute a sequence of interactive actions', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));
      
      // Create sequence container with interactive elements
      const sequenceContainer = document.createElement('div');
      sequenceContainer.id = 'test-sequence';
      
      // Add interactive elements to sequence
      const step1 = document.createElement('button');
      step1.className = 'interactive';
      step1.setAttribute('data-targetaction', 'highlight');
      step1.setAttribute('data-reftarget', '.target-1');
      step1.textContent = 'Step 1';
      sequenceContainer.appendChild(step1);

      const step2 = document.createElement('button');
      step2.className = 'interactive';
      step2.setAttribute('data-targetaction', 'button');
      step2.setAttribute('data-reftarget', 'Click Me');
      step2.textContent = 'Step 2';
      sequenceContainer.appendChild(step2);

      // Important: Add sequence container to the containerRef
      container.appendChild(sequenceContainer);

      // Add target elements
      const target1 = document.createElement('div');
      target1.className = 'target-1';
      document.body.appendChild(target1);

      const target2 = document.createElement('button');
      target2.textContent = 'Click Me';
      const clickSpy = jest.spyOn(target2, 'click');
      document.body.appendChild(target2);

      // Execute sequence
      await act(async () => {
        await result.current.interactiveFocus(
          {
            reftarget: '.target-1',
            targetaction: 'highlight',
            tagName: 'div'
          },
          false, // show mode
          step1
        );
      });

      // Wait for any animations or async operations
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify sequence effects
      expect(target1.classList.contains('interactive-highlighted')).toBeTruthy();
      expect(clickSpy).not.toHaveBeenCalled(); // In show mode, buttons aren't clicked
    });
  });

  describe('Requirements Checking', () => {
    beforeEach(() => {
      checkRequirements.mockReset();
    });

    it('should check element requirements', async () => {
      // Setup mock response for success case
      checkRequirements.mockResolvedValueOnce({
        pass: true,
        requirements: 'exists-reftarget',
        error: [{
          requirement: 'exists-reftarget',
          pass: true
        }]
      });

      const { result } = renderHook(() => useInteractiveElements({ containerRef }));
      
      // Create element with requirements
      const element = document.createElement('button');
      element.setAttribute('data-requirements', 'exists-reftarget');
      element.setAttribute('data-reftarget', '#target');
      element.setAttribute('data-targetaction', 'highlight');

      // Create target element
      const target = document.createElement('div');
      target.id = 'target';
      document.body.appendChild(target);

      // Check requirements
      const check = await result.current.checkElementRequirements(element);

      // Verify requirements check
      expect(check.pass).toBeTruthy();
      expect(check.error).toEqual(expect.arrayContaining([
        expect.objectContaining({
          requirement: 'exists-reftarget',
          pass: true
        })
      ]));
    });

    it('should handle failed requirements', async () => {
      // Setup mock response for failure case
      checkRequirements.mockResolvedValueOnce({
        pass: false,
        requirements: 'exists-reftarget',
        error: [{
          requirement: 'exists-reftarget',
          pass: false,
          error: 'Element not found'
        }]
      });

      const { result } = renderHook(() => useInteractiveElements({ containerRef }));
      
      // Create element with requirements but no target
      const element = document.createElement('button');
      element.setAttribute('data-requirements', 'exists-reftarget');
      element.setAttribute('data-reftarget', '#nonexistent');
      element.setAttribute('data-targetaction', 'highlight');

      // Check requirements
      const check = await result.current.checkElementRequirements(element);

      // Verify requirements check failed
      expect(check.pass).toBeFalsy();
      expect(check.error).toEqual(expect.arrayContaining([
        expect.objectContaining({
          requirement: 'exists-reftarget',
          pass: false
        })
      ]));
    });
  });

  describe('Direct Action Execution', () => {
    it('should execute actions directly via executeInteractiveAction', async () => {
      const { result } = renderHook(() => useInteractiveElements({ containerRef }));
      
      // Create target button
      const button = document.createElement('button');
      button.textContent = 'Target Button';
      document.body.appendChild(button);
      const clickSpy = jest.spyOn(button, 'click');

      // Execute action directly
      await act(async () => {
        await result.current.executeInteractiveAction(
          'button',
          'Target Button',
          undefined,
          'do'
        );
      });

      // Verify action was executed
      expect(clickSpy).toHaveBeenCalled();
    });
  });
});