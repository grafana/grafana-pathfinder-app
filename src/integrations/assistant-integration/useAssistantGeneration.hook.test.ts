import { act, renderHook } from '@testing-library/react';
import { Subject } from 'rxjs';
import { getIsAssistantAvailable } from './assistant-dev-mode';
import { useAssistantGeneration } from './useAssistantGeneration.hook';

jest.mock('@grafana/assistant', () => ({
  ...jest.requireActual('@grafana/assistant'),
  useInlineAssistant: jest.fn(() => ({})),
  useProvidePageContext: jest.fn(),
}));
jest.mock('./assistant-dev-mode', () => ({
  getIsAssistantAvailable: jest.fn(),
  useMockInlineAssistant: jest.fn(() => ({})),
}));
jest.mock('../../utils/dev-mode', () => ({ isAssistantDevModeEnabledGlobal: jest.fn(() => false) }));

it('distinguishes a pending availability check from confirmed unavailability and tracks subsequent updates', () => {
  const availability = new Subject<boolean>();
  jest.mocked(getIsAssistantAvailable).mockReturnValue(availability);
  const { result, unmount } = renderHook(() =>
    useAssistantGeneration({ contentKey: 'test-guide', assistantId: 'customize-guide' })
  );
  expect(result.current.isCheckingAssistantAvailability).toBe(true);
  expect(result.current.isAssistantAvailable).toBe(false);
  act(() => availability.next(true));
  expect(result.current.isCheckingAssistantAvailability).toBe(false);
  expect(result.current.isAssistantAvailable).toBe(true);
  act(() => availability.next(false));
  expect(result.current.isCheckingAssistantAvailability).toBe(false);
  expect(result.current.isAssistantAvailable).toBe(false);
  unmount();
  expect(availability.observed).toBe(false);
});
