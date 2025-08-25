const { merge } = require('webpack-merge');

module.exports = (env) => {
  // Import the base Grafana webpack configuration (may return a Promise)
  const grafanaConfigOrPromise = require('./.config/webpack/webpack.config.ts').default(env);

  const extend = (grafanaConfig) =>
    merge(grafanaConfig, {
      // Add i18next as external for plugin internationalization support
      externals: [...(grafanaConfig.externals || []), 'i18next'],
    });

  // Support both sync and async base configs without using async/await
  if (grafanaConfigOrPromise && typeof grafanaConfigOrPromise.then === 'function') {
    return grafanaConfigOrPromise.then(extend);
  }
  return extend(grafanaConfigOrPromise);
};
