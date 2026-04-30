/**
 * Environment-context checks: feature toggles, build environment, version,
 * and renderer context.
 */

import { config } from '@grafana/runtime';
import type { CheckResultError } from '../requirements-checker.utils';

/**
 * Feature toggle: `has-feature:<name>`.
 */
export async function hasFeatureCheck(check: string): Promise<CheckResultError> {
  try {
    const featureName = check.replace('has-feature:', '');
    const featureToggles = config.featureToggles as Record<string, boolean> | undefined;
    const isEnabled = featureToggles && featureToggles[featureName];

    return {
      requirement: check,
      pass: !!isEnabled,
      error: isEnabled ? undefined : `Feature toggle '${featureName}' is not enabled`,
    };
  } catch (error) {
    return {
      requirement: check,
      pass: false,
      error: `Feature check failed: ${error}`,
    };
  }
}

/**
 * Build environment match: `in-environment:<env>` (case-insensitive).
 */
export async function inEnvironmentCheck(check: string): Promise<CheckResultError> {
  try {
    const requiredEnv = check.replace('in-environment:', '').toLowerCase();
    const currentEnv = config.buildInfo?.env?.toLowerCase() || 'unknown';

    return {
      requirement: check,
      pass: currentEnv === requiredEnv,
      error:
        currentEnv === requiredEnv
          ? undefined
          : `Current environment '${currentEnv}' does not match required '${requiredEnv}'`,
    };
  } catch (error) {
    return {
      requirement: check,
      pass: false,
      error: `Environment check failed: ${error}`,
    };
  }
}

/**
 * Semantic-version compare: `min-version:<major.minor.patch>`.
 */
export async function minVersionCheck(check: string): Promise<CheckResultError> {
  try {
    const requiredVersion = check.replace('min-version:', '');
    const currentVersion = config.buildInfo?.version || '0.0.0';

    const parseVersion = (v: string): [number, number, number] => {
      const parts = v.split('.').map((n) => parseInt(n, 10));
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
    };
    const [reqMajor, reqMinor, reqPatch] = parseVersion(requiredVersion);
    const [curMajor, curMinor, curPatch] = parseVersion(currentVersion);

    const meetsRequirement =
      curMajor > reqMajor ||
      (curMajor === reqMajor && curMinor > reqMinor) ||
      (curMajor === reqMajor && curMinor === reqMinor && curPatch >= reqPatch);

    return {
      requirement: check,
      pass: meetsRequirement,
      error: meetsRequirement
        ? undefined
        : `Current version '${currentVersion}' does not meet minimum requirement '${requiredVersion}'`,
    };
  } catch (error) {
    return {
      requirement: check,
      pass: false,
      error: `Version check failed: ${error}`,
    };
  }
}

/**
 * Renderer context: `renderer:pathfinder` always passes in this app, `renderer:website`
 * always fails. Other tools (the website renderer) interpret this requirement
 * differently to gate context-specific content.
 */
export async function rendererCheck(check: string): Promise<CheckResultError> {
  try {
    const rendererValue = check.replace('renderer:', '').toLowerCase();

    if (rendererValue === 'pathfinder') {
      return {
        requirement: check,
        pass: true,
        error: undefined,
        context: { renderer: rendererValue, context: 'app' },
      };
    }

    if (rendererValue === 'website') {
      return {
        requirement: check,
        pass: false,
        error: `Renderer requirement '${check}' is not satisfied (website context is not available in app)`,
        context: { renderer: rendererValue, context: 'app' },
      };
    }

    return {
      requirement: check,
      pass: false,
      error: `Unknown renderer value: '${rendererValue}'. Supported values: 'pathfinder', 'website'`,
      context: { renderer: rendererValue, supported: ['pathfinder', 'website'] },
    };
  } catch (error) {
    return {
      requirement: check,
      pass: false,
      error: `Renderer check failed: ${error}`,
      context: { error: String(error) },
    };
  }
}
