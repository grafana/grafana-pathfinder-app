import path from 'path';
import type { Configuration } from 'webpack';
import { merge } from 'webpack-merge';
import FaroSourceMapUploaderPlugin from '@grafana/faro-webpack-plugin';
import grafanaConfig, { type Env } from './.config/webpack/webpack.config';

const config = async (env: Env): Promise<Configuration> => {
  const baseConfig = await grafanaConfig(env);
  const faroSourceMapApiKey = process.env.FARO_SOURCEMAP_API_KEY;

  return merge(baseConfig, {
    externals: ['react/jsx-runtime', 'react/jsx-dev-runtime'],
    resolve: {
      alias: {
        // Fix dual-package hazard: @grafana/i18n ships separate ESM and CJS entry points
        // via package.json "exports" conditions. Webpack resolves `import` to dist/esm/
        // and `require` (used by @grafana/scenes) to dist/cjs/, creating TWO module
        // instances with separate `tFunc` state. This alias forces both to the CJS bundle
        // so initPluginTranslations and @grafana/scenes share one `tFunc` variable.
        '@grafana/i18n': path.resolve(__dirname, 'node_modules/@grafana/i18n/dist/cjs/index.cjs'),
      },
    },
    // Absent outside of CI runs that supply the API key, so local and PR builds
    // never attempt an upload.
    plugins:
      env.production && faroSourceMapApiKey
        ? [
            new FaroSourceMapUploaderPlugin({
              appName: 'grafana-pathfinder-app',
              endpoint: 'https://faro-api-ops-eu-south-0.grafana-ops.net/faro/api/v1',
              appId: '77',
              stackId: '27821',
              apiKey: faroSourceMapApiKey,
              gzipContents: true,
              verbose: true,
            }),
          ]
        : [],
  });
};

export default config;
