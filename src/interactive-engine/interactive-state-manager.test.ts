import { InteractiveStateManager } from './interactive-state-manager';
import { InteractiveElementData } from '../types/interactive.types';

describe('InteractiveStateManager', () => {
  let manager: InteractiveStateManager;
  let data: InteractiveElementData;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    manager = new InteractiveStateManager();
    data = {
      reftarget: 'selector',
      targetaction: 'button',
      tagName: 'button',
    };
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('should dispatch event on setState completed', async () => {
    const dispatchSpy = jest.spyOn(document, 'dispatchEvent');
    await manager.setState(data, 'completed');
    expect(dispatchSpy).toHaveBeenCalledWith(expect.any(CustomEvent));
    dispatchSpy.mockRestore();
  });

  it('should not log or dispatch interactive-action-completed event on setState running', async () => {
    const dispatchSpy = jest.spyOn(document, 'dispatchEvent');
    await manager.setState(data, 'running');
    expect(consoleLogSpy).not.toHaveBeenCalled();

    // Check that no 'interactive-action-completed' event was dispatched
    const completedEvents = dispatchSpy.mock.calls.filter(
      (call) => call[0] instanceof CustomEvent && call[0].type === 'interactive-action-completed'
    );
    expect(completedEvents).toHaveLength(0);

    dispatchSpy.mockRestore();
  });

  it('should log error with logError', () => {
    manager.logError('context', 'error message', data);
    expect(consoleErrorSpy).toHaveBeenCalledWith('[pathfinder]', 'context: error message', data);
  });

  it('should call setState and throw on handleError with shouldThrow', () => {
    const setStateSpy = jest.spyOn(manager, 'setState');
    expect(() => manager.handleError('err', 'ctx', data, true)).toThrow('err');
    expect(setStateSpy).toHaveBeenCalledWith(data, 'error');
    setStateSpy.mockRestore();
  });

  it('should call setState and not throw on handleError with shouldThrow false', () => {
    const setStateSpy = jest.spyOn(manager, 'setState');
    expect(() => manager.handleError('err', 'ctx', data, false)).not.toThrow();
    expect(setStateSpy).toHaveBeenCalledWith(data, 'error');
    setStateSpy.mockRestore();
  });
});
