const { merge } = require('webpack-merge');

module.exports = async (env) => {
  // Import the base Grafana webpack configuration
  const grafanaConfig = await require('./.config/webpack/webpack.config.ts').default(env);
  
  // Extend it with our custom configuration
  return merge(grafanaConfig, {
    // Add i18next as external for plugin internationalization support
    externals: [...(grafanaConfig.externals || []), 'i18next'],
  });
};
