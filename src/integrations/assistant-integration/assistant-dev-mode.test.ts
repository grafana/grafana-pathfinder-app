import { renderHook, act } from '@testing-library/react';

jest.mock('../../lib/logging', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../../utils/dev-mode', () => ({ isAssistantDevModeEnabledGlobal: jest.fn(() => true) }));
jest.mock('@grafana/assistant', () => ({
  isAssistantAvailable: jest.fn(),
  openAssistant: jest.fn(),
}));

import { logger } from '../../lib/logging';
import { getOpenAssistant, useMockInlineAssistant } from './assistant-dev-mode';

const faroBackedLevels = () => [logger.info, logger.warn, logger.error] as jest.Mock[];

beforeEach(() => jest.clearAllMocks());

describe('assistant dev mode dumps stay local-only', () => {
  it('openAssistant dump uses logger.debug, never a Faro-backed level', () => {
    getOpenAssistant({ origin: 'test/origin', prompt: 'sensitive prompt', context: [], autoSend: false });

    expect(logger.debug).toHaveBeenCalledWith('Prompt', { prompt: 'sensitive prompt' });
    faroBackedLevels().forEach((level) => expect(level).not.toHaveBeenCalled());
  });

  it('inline assistant dump uses logger.debug, never a Faro-backed level', async () => {
    const { result } = renderHook(() => useMockInlineAssistant());

    await act(async () => {
      await result.current.generate({
        origin: 'test/origin',
        prompt: 'sensitive prompt',
        systemPrompt: 'sensitive system prompt',
      });
    });

    expect(logger.debug).toHaveBeenCalledWith('System Prompt', { systemPrompt: 'sensitive system prompt' });
    faroBackedLevels().forEach((level) => expect(level).not.toHaveBeenCalled());
  });
});
