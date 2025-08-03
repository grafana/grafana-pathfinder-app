import { safeEventHandler, createSafeEventHandler, SafeEventOptions } from './safe-event-handler.util';

describe('safeEventHandler', () => {
  let mockEvent: Event;

  beforeEach(() => {
    mockEvent = {
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      stopImmediatePropagation: jest.fn(),
      cancelable: true,
    } as unknown as Event;
  });

  it('should call preventDefault when event is cancelable', () => {
    safeEventHandler(mockEvent, { preventDefault: true });
    expect(mockEvent.preventDefault).toHaveBeenCalled();
  });

  it('should not call preventDefault when event is not cancelable', () => {
    mockEvent.cancelable = false;
    safeEventHandler(mockEvent, { preventDefault: true });
    expect(mockEvent.preventDefault).not.toHaveBeenCalled();
  });

  it('should call stopPropagation when specified', () => {
    safeEventHandler(mockEvent, { stopPropagation: true });
    expect(mockEvent.stopPropagation).toHaveBeenCalled();
  });

  it('should call stopImmediatePropagation when specified', () => {
    safeEventHandler(mockEvent, { stopImmediatePropagation: true });
    expect(mockEvent.stopImmediatePropagation).toHaveBeenCalled();
  });

  it('should work with default options', () => {
    safeEventHandler(mockEvent);
    expect(mockEvent.preventDefault).not.toHaveBeenCalled();
    expect(mockEvent.stopPropagation).not.toHaveBeenCalled();
    expect(mockEvent.stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it('should handle multiple options together', () => {
    safeEventHandler(mockEvent, {
      preventDefault: true,
      stopPropagation: true,
      stopImmediatePropagation: true,
    });
    expect(mockEvent.preventDefault).toHaveBeenCalled();
    expect(mockEvent.stopPropagation).toHaveBeenCalled();
    expect(mockEvent.stopImmediatePropagation).toHaveBeenCalled();
  });
});

describe('createSafeEventHandler', () => {
  let mockEvent: Event;
  let handlerFn: jest.Mock;

  beforeEach(() => {
    mockEvent = {
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      stopImmediatePropagation: jest.fn(),
      cancelable: true,
    } as unknown as Event;
    handlerFn = jest.fn();
  });

  it('should create a handler that calls both safe handler and provided handler', () => {
    const wrappedHandler = createSafeEventHandler(handlerFn, { preventDefault: true });
    wrappedHandler(mockEvent);

    expect(mockEvent.preventDefault).toHaveBeenCalled();
    expect(handlerFn).toHaveBeenCalledWith(mockEvent);
  });

  it('should preserve the order of operations - safe handling first, then handler', () => {
    const operations: string[] = [];
    const mockPreventDefault = jest.fn(() => operations.push('preventDefault'));
    mockEvent.preventDefault = mockPreventDefault;

    const handler = jest.fn(() => operations.push('handler'));
    const wrappedHandler = createSafeEventHandler(handler, { preventDefault: true });
    wrappedHandler(mockEvent);

    expect(operations).toEqual(['preventDefault', 'handler']);
  });

  it('should work with typed events', () => {
    const mockKeyboardEvent = {
      ...mockEvent,
      key: 'Enter',
      code: 'Enter',
    } as unknown as KeyboardEvent;

    const keyHandler = (e: KeyboardEvent) => {
      expect(e.key).toBe('Enter');
    };

    const wrappedHandler = createSafeEventHandler(keyHandler);
    wrappedHandler(mockKeyboardEvent);
  });
});

describe('Event Listener Options', () => {
  it('should export correct safe event listener options', () => {
    const { safeEventListenerOptions } = require('./safe-event-handler.util');
    expect(safeEventListenerOptions).toEqual({
      passive: false,
      capture: false,
    });
  });

  it('should export correct passive event listener options', () => {
    const { passiveEventListenerOptions } = require('./safe-event-handler.util');
    expect(passiveEventListenerOptions).toEqual({
      passive: true,
      capture: false,
    });
  });
});
