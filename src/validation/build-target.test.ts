/**
 * @jest-environment node
 */
import * as path from 'path';
import type { Configuration, RuleSetRule } from 'webpack';

// Loaded at runtime so tsc does not pull the root webpack config and the
// create-plugin .config tree into the src program.
const webpackConfig = require(path.resolve(__dirname, '../../webpack.config.ts')) as {
  default: (env: Record<string, true>) => Promise<Configuration>;
  SWC_TARGET: string;
};

function swcTargets(resolved: Configuration): unknown[] {
  return (resolved.module?.rules ?? [])
    .filter(
      (rule): rule is RuleSetRule =>
        typeof rule === 'object' && rule !== null && (rule.use as { loader?: string })?.loader === 'swc-loader'
    )
    .map((rule) => (rule.use as { options: { jsc: { target?: string } } }).options.jsc.target);
}

it.each<Record<string, true>>([{ production: true }, { development: true }])(
  'compiles source to the ES2022 target Grafana itself ships (%j)',
  async (env) => {
    expect(webpackConfig.SWC_TARGET).toBe('es2022');
    const targets = swcTargets(await webpackConfig.default(env));
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every((target) => target === webpackConfig.SWC_TARGET)).toBe(true);
  }
);
