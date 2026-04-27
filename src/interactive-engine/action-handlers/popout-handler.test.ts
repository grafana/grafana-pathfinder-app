import { PopoutHandler } from './popout-handler';
import { InteractiveStateManager } from '../interactive-state-manager';
import { InteractiveElementData } from '../../types/interactive.types';

jest.mock('../interactive-state-manager');

const mockStateManager = {
  setState: jest.fn(),
  handleError: jest.fn(),
} as unknown as InteractiveStateManager;

const mockWaitForReactUpdates = jest.fn().mockResolvedValue(undefined);

function makeData(overrides: Partial<InteractiveElementData> = {}): InteractiveElementData {
  return {
    reftarget: '',
    targetaction: 'popout',
    targetvalue: 'floating',
    tagName: 'button',
    textContent: 'Popout step',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('PopoutHandler', () => {
  let handler: PopoutHandler;
  let dispatchSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    handler = new PopoutHandler(mockStateManager, mockWaitForReactUpdates);
    dispatchSpy = jest.spyOn(document, 'dispatchEvent');
  });

  afterEach(() => {
    dispatchSpy.mockRestore();
    jest.useRealTimers();
  });

  it("dispatches 'pathfinder-request-pop-out' when targetvalue is 'floating'", async () => {
    const data = makeData({ targetvalue: 'floating' });
    const promise = handler.execute(data, true);
    await jest.runAllTimersAsync();
    await promise;

    expect(mockStateManager.setState).toHaveBeenCalledWith(data, 'running');
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const event = dispatchSpy.mock.calls[0]![0] as Event;
    expect(event.type).toBe('pathfinder-request-pop-out');
    expect(mockStateManager.setState).toHaveBeenCalledWith(data, 'completed');
  });

  it("dispatches 'pathfinder-request-dock' when targetvalue is 'sidebar'", async () => {
    const data = makeData({ targetvalue: 'sidebar' });
    const promise = handler.execute(data, true);
    await jest.runAllTimersAsync();
    await promise;

    const event = dispatchSpy.mock.calls[0]![0] as Event;
    expect(event.type).toBe('pathfinder-request-dock');
    expect(mockStateManager.setState).toHaveBeenCalledWith(data, 'completed');
  });

  it('treats show mode the same as do mode (single-button action)', async () => {
    // Popout has no preview - both buttonType paths should still dispatch and complete.
    const data = makeData({ targetvalue: 'floating' });
    const promise = handler.execute(data, false);
    await jest.runAllTimersAsync();
    await promise;

    const event = dispatchSpy.mock.calls[0]![0] as Event;
    expect(event.type).toBe('pathfinder-request-pop-out');
    expect(mockStateManager.setState).toHaveBeenCalledWith(data, 'completed');
  });

  it('reports an error when targetvalue is missing or invalid', async () => {
    const data = makeData({ targetvalue: 'nonsense' });
    await handler.execute(data, true);

    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(mockStateManager.handleError).toHaveBeenCalledWith(expect.any(Error), 'PopoutHandler', data, true);
  });

  it('reports an error when targetvalue is undefined', async () => {
    const data = makeData({ targetvalue: undefined });
    await handler.execute(data, true);

    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(mockStateManager.handleError).toHaveBeenCalled();
  });
});
