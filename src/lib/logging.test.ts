import { logger } from './logging';
import { pushFaroError, pushFaroLog } from './faro';

jest.mock('./faro', () => ({
  pushFaroLog: jest.fn(),
  pushFaroError: jest.fn(),
}));

const mockPushFaroLog = pushFaroLog as jest.Mock;
const mockPushFaroError = pushFaroError as jest.Mock;

describe('logger', () => {
  let debugSpy: jest.SpyInstance;
  let infoSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    debugSpy = jest.spyOn(console, 'log').mockImplementation();
    infoSpy = jest.spyOn(console, 'info').mockImplementation();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    errorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    debugSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe('debug', () => {
    it('logs to console but never reaches Faro', () => {
      logger.debug('debugging', { step: 'one' });
      expect(debugSpy).toHaveBeenCalledWith('debugging', { step: 'one' });
      expect(mockPushFaroLog).not.toHaveBeenCalled();
    });
  });

  describe('info / warn / error', () => {
    it('routes info to console.info and pushFaroLog with level "info"', () => {
      logger.info('something happened', { step: 'one' });
      expect(infoSpy).toHaveBeenCalledWith('something happened', { step: 'one' });
      expect(mockPushFaroLog).toHaveBeenCalledWith('info', 'something happened', { step: 'one' });
    });

    it('routes warn to console.warn and pushFaroLog with level "warn"', () => {
      logger.warn('careful', { step: 'two' });
      expect(warnSpy).toHaveBeenCalledWith('careful', { step: 'two' });
      expect(mockPushFaroLog).toHaveBeenCalledWith('warn', 'careful', { step: 'two' });
    });

    it('routes error to console.error and pushFaroLog with level "error"', () => {
      logger.error('broken', { step: 'three' });
      expect(errorSpy).toHaveBeenCalledWith('broken', { step: 'three' });
      expect(mockPushFaroLog).toHaveBeenCalledWith('error', 'broken', { step: 'three' });
    });

    it('omits context entirely when none is passed', () => {
      logger.warn('no context here');
      expect(warnSpy).toHaveBeenCalledWith('no context here', '');
      expect(mockPushFaroLog).toHaveBeenCalledWith('warn', 'no context here', undefined);
    });

    it('sanitizes the message before logging (newline injection)', () => {
      logger.warn('line one\nFAKE ENTRY: line two');
      expect(warnSpy).toHaveBeenCalledWith('line one\\nFAKE ENTRY: line two', '');
      expect(mockPushFaroLog).toHaveBeenCalledWith('warn', 'line one\\nFAKE ENTRY: line two', undefined);
    });

    it('coerces non-string context values to sanitized strings', () => {
      logger.error('failed', { count: 3, ok: false });
      expect(mockPushFaroLog).toHaveBeenCalledWith('error', 'failed', { count: '3', ok: 'false' });
    });

    it('does not add its own try/catch around pushFaroLog, which already guarantees no-throw', () => {
      mockPushFaroLog.mockImplementationOnce(() => {
        throw new Error('transport down');
      });
      expect(() => logger.error('boom')).toThrow('transport down');
    });
  });

  describe('error with a throwable — routes to pushFaroError, not pushFaroLog', () => {
    it('accepts an Error as the second argument', () => {
      const boom = new Error('boom');
      logger.error('operation failed', boom);
      expect(errorSpy).toHaveBeenCalledWith('operation failed', boom, '');
      expect(mockPushFaroError).toHaveBeenCalledWith(boom, { message: 'operation failed' });
      expect(mockPushFaroLog).not.toHaveBeenCalled();
    });

    it('accepts an Error second argument with a separate context object', () => {
      const boom = new Error('boom');
      logger.error('operation failed', boom, { step: 'two' });
      expect(mockPushFaroError).toHaveBeenCalledWith(boom, { step: 'two', message: 'operation failed' });
    });

    it('extracts an Error from the legacy { error } context shape, keeping the other keys', () => {
      const boom = new Error('boom');
      logger.error('operation failed', { error: boom, step: 'two' });
      expect(errorSpy).toHaveBeenCalledWith('operation failed', boom, { step: 'two' });
      expect(mockPushFaroError).toHaveBeenCalledWith(boom, { step: 'two', message: 'operation failed' });
      expect(mockPushFaroLog).not.toHaveBeenCalled();
    });

    it('stays a plain error log when the error context key is not an Error instance', () => {
      logger.error('operation failed', { error: 'not found' });
      expect(mockPushFaroError).not.toHaveBeenCalled();
      expect(mockPushFaroLog).toHaveBeenCalledWith('error', 'operation failed', { error: 'not found' });
    });

    it('serializes an Error left in a warn context instead of collapsing it to "{}"', () => {
      logger.warn('careful', { error: new Error('boom') });
      const [, , context] = mockPushFaroLog.mock.calls[0];
      expect(context.error).toContain('Error: boom');
      expect(context.error).not.toBe('{}');
    });
  });

  describe('exception', () => {
    it('logs a real Error unchanged and forwards it to pushFaroError', () => {
      const error = new Error('kaboom');
      logger.exception(error, { source: 'test' });
      expect(errorSpy).toHaveBeenCalledWith(error, { source: 'test' });
      expect(mockPushFaroError).toHaveBeenCalledWith(error, { source: 'test' });
    });

    it('normalizes a non-Error throwable into an Error before forwarding', () => {
      logger.exception('a raw string throw');
      expect(mockPushFaroError).toHaveBeenCalledTimes(1);
      const [normalized] = mockPushFaroError.mock.calls[0];
      expect(normalized).toBeInstanceOf(Error);
      expect(normalized.message).toBe('a raw string throw');
    });
  });
});
