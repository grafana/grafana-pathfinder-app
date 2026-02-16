import path from 'path';
import type { Configuration } from 'webpack';
import { merge } from 'webpack-merge';
import grafanaConfig, { type Env } from './.config/webpack/webpack.config';

const config = async (env: Env): Promise<Configuration> => {
  const baseConfig = await grafanaConfig(env);

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
  });
};

export default config;
