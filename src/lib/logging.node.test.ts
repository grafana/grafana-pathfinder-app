/**
 * @jest-environment node
 */

describe('logger in Node', () => {
  it('does not load Faro when imported or used without a browser window', () => {
    jest.isolateModules(() => {
      jest.doMock('./faro', () => {
        throw new Error('Faro should not load in Node logging');
      });
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const { logger } = require('./logging') as typeof import('./logging');

      expect(() => logger.warn('node-side warning')).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith('node-side warning', '');

      warnSpy.mockRestore();
    });
  });
});
