jest.mock('@grafana/i18n', () => ({ initPluginTranslations: jest.fn() }));

function setup() {
  jest.resetModules();
  const { initPluginTranslations } = require('@grafana/i18n');
  const helpers: typeof import('./plugin-translations') = require('./plugin-translations');
  return { ...helpers, initialize: initPluginTranslations as jest.Mock };
}

it('does no initialization until requested and shares concurrent and subsequent requests', async () => {
  const { ensurePluginTranslations, initialize } = setup();
  expect(initialize).not.toHaveBeenCalled();
  const first = ensurePluginTranslations();
  expect(ensurePluginTranslations()).toBe(first);
  await first;
  await ensurePluginTranslations();
  expect(initialize).toHaveBeenCalledTimes(1);
  expect(initialize).toHaveBeenCalledWith('grafana-pathfinder-app');
});

it('does not evaluate feature modules until translations finish initializing', async () => {
  const { loadTranslatedModule, initialize } = setup();
  let ready!: () => void;
  initialize.mockReturnValue(new Promise<void>((resolve) => (ready = resolve)));
  const feature = jest.fn().mockResolvedValue('feature');
  const result = loadTranslatedModule(feature);
  await Promise.resolve();
  await Promise.resolve();
  expect(feature).not.toHaveBeenCalled();
  ready();
  await expect(result).resolves.toBe('feature');
  expect(feature).toHaveBeenCalledTimes(1);
});

it('allows a new attempt after initialization fails without evaluating the feature', async () => {
  const { loadTranslatedModule, initialize } = setup();
  const error = new Error('Translation initialization failed');
  initialize.mockRejectedValueOnce(error).mockResolvedValue(undefined);
  const feature = jest.fn().mockResolvedValue('feature');
  await expect(loadTranslatedModule(feature)).rejects.toBe(error);
  expect(feature).not.toHaveBeenCalled();
  await expect(loadTranslatedModule(feature)).resolves.toBe('feature');
  expect(initialize).toHaveBeenCalledTimes(2);
});

it('retries feature chunk failures without reinitializing translations', async () => {
  jest.useFakeTimers();
  try {
    const { loadTranslatedModule, initialize } = setup();
    const error = Object.assign(new Error('Chunk download failed'), { name: 'ChunkLoadError' });
    const feature = jest.fn().mockRejectedValueOnce(error).mockResolvedValue('feature');
    const result = loadTranslatedModule(feature);
    await jest.runAllTimersAsync();
    await expect(result).resolves.toBe('feature');
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(feature).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});

it('releases shared initialization after translation chunk retries are exhausted', async () => {
  jest.resetModules();
  jest.useFakeTimers();
  const initialize = jest.fn();
  let attempts = 0;
  jest.doMock('@grafana/i18n', () => {
    if (++attempts <= 4) {
      throw Object.assign(new Error('Translation chunk unavailable'), { name: 'ChunkLoadError' });
    }
    return { initPluginTranslations: initialize };
  });
  try {
    const { ensurePluginTranslations }: typeof import('./plugin-translations') = require('./plugin-translations');
    const first = ensurePluginTranslations();
    expect(ensurePluginTranslations()).toBe(first);
    const rejected = expect(first).rejects.toThrow('Translation chunk unavailable');
    await jest.runAllTimersAsync();
    await rejected;
    expect(initialize).not.toHaveBeenCalled();
    await ensurePluginTranslations();
    expect(attempts).toBe(5);
    expect(initialize).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});
