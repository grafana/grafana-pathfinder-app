import path from 'path';
import type { Configuration, RuleSetRule } from 'webpack';
import { merge } from 'webpack-merge';
import FaroSourceMapUploaderPlugin from '@grafana/faro-webpack-plugin';
import grafanaConfig, { type Env } from './.config/webpack/webpack.config';

// Grafana derives its own build target from `last 2` browser versions
// (grafana/grafana .browserslistrc) and ships ES2022 syntax, so any browser that
// runs Grafana parses it. The scaffolded es2015 inlines helpers into every chunk.
export const SWC_TARGET = 'es2022';

function setSwcTarget(config: Configuration, target: string): void {
  const swcRules = (config.module?.rules ?? []).filter(
    (rule): rule is RuleSetRule =>
      typeof rule === 'object' && rule !== null && (rule.use as { loader?: string })?.loader === 'swc-loader'
  );
  if (swcRules.length === 0) {
    throw new Error('No swc-loader rule found in the scaffolded webpack config; cannot set the SWC target');
  }
  for (const rule of swcRules) {
    const use = rule.use as { options: { jsc: { target?: string } } };
    use.options.jsc.target = target;
  }
}

const config = async (env: Env): Promise<Configuration> => {
  const baseConfig = await grafanaConfig(env);
  setSwcTarget(baseConfig, SWC_TARGET);

  // Sourced from Vault (repo/grafana/grafana-pathfinder-app/faro-connection +
  // .../FARO_SOURCEMAP_API_KEY) via CI, never hardcoded. appName is the one
  // exception — it's not connection-specific, just this plugin's identity.
  const faroSourceMap =
    env.production &&
    process.env.FARO_SOURCEMAP_API_KEY &&
    process.env.FARO_SOURCEMAP_ENDPOINT &&
    process.env.FARO_SOURCEMAP_APP_ID &&
    process.env.FARO_SOURCEMAP_STACK_ID
      ? {
          apiKey: process.env.FARO_SOURCEMAP_API_KEY,
          endpoint: process.env.FARO_SOURCEMAP_ENDPOINT,
          appId: process.env.FARO_SOURCEMAP_APP_ID,
          stackId: process.env.FARO_SOURCEMAP_STACK_ID,
        }
      : null;

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
    // Absent outside of CI runs that supply the full connection config, so
    // local and PR builds never attempt an upload.
    plugins: faroSourceMap
      ? [
          new FaroSourceMapUploaderPlugin({
            appName: 'grafana-pathfinder-app',
            ...faroSourceMap,
            gzipContents: true,
            verbose: true,
          }),
        ]
      : [],
  });
};

export default config;
