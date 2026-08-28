/**
 * `grafana:` selector coverage for bundled guides.
 *
 * `resolveSelectors` floors an out-of-range target version to the *lowest* entry
 * in a selector's version map, so a token added in Grafana 13.2 still resolves —
 * to its 13.2 value — on 12.3, and matches nothing. No throw, no fallback, just a
 * step whose `exists-reftarget` never passes. Three invariants keep that off a
 * user's screen: every token resolves at the guide's declared floor, the declared
 * floor covers every token the guide uses, and a token newer than the plugin's own
 * Grafana floor is gated at runtime by `min-version:`.
 */

import * as fs from 'fs';
import * as path from 'path';

import { versionedComponents, versionedPages } from '@grafana/e2e-selectors';

import { compareVersions, parseVersion } from '../cli/e2e/manifest-preflight';
import { discoverBundledGuideFiles } from '../cli/utils/file-loader';
import { resolveSelectorForVersion } from '../lib/dom/selector-resolver-core';

type Version = [number, number, number];
type SelectorNode = Record<string, unknown>;

const BUNDLED_DIR = path.resolve(__dirname, '../bundled-interactives');
const SELECTOR_ROOTS: SelectorNode = { components: versionedComponents, pages: versionedPages };
const GRAFANA_PREFIX = 'grafana:';
const MIN_VERSION_PREFIX = 'min-version:';
const EMBEDDED_TOKEN = /\{grafana:([^}]+)\}/g;

function formatVersion(version: Version): string {
  return version.join('.');
}

function readPluginFloor(): Version {
  const pluginJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../plugin.json'), 'utf-8'));
  const range: string = pluginJson.dependencies?.grafanaDependency ?? '';
  const floor = parseVersion(range.replace(/^[^0-9]*/, ''));
  if (!floor) {
    throw new Error(`plugin.json grafanaDependency "${range}" is not a range this test can read`);
  }
  return floor;
}

const PLUGIN_FLOOR = readPluginFloor();

function tokensIn(reftarget: string): string[] {
  if (reftarget.includes(`{${GRAFANA_PREFIX}`)) {
    return Array.from(reftarget.matchAll(EMBEDDED_TOKEN), (match) => match[1]).filter(
      (token): token is string => token !== undefined
    );
  }
  return reftarget.startsWith(GRAFANA_PREFIX) ? [reftarget.slice(GRAFANA_PREFIX.length)] : [];
}

function selectorPathOf(token: string): string {
  const colon = token.indexOf(':');
  return colon !== -1 && colon < token.length - 1 ? token.slice(0, colon) : token;
}

/**
 * Lowest version in a selector's version map — the first Grafana release that
 * renders it. `null` when the path names no versioned selector at all.
 */
function introducedVersion(selectorPath: string): Version | null {
  let node: unknown = SELECTOR_ROOTS;
  for (const part of selectorPath.split('.')) {
    if (!node || typeof node !== 'object') {
      return null;
    }
    node = (node as SelectorNode)[part];
  }
  if (!node || typeof node !== 'object') {
    return null;
  }
  const versions = Object.keys(node as SelectorNode)
    .map(parseVersion)
    .filter((version): version is Version => version !== null)
    .sort(compareVersions);
  return versions[0] ?? null;
}

function minVersionGates(requirements: unknown): Version[] {
  if (!Array.isArray(requirements)) {
    return [];
  }
  return requirements
    .filter((requirement): requirement is string => typeof requirement === 'string')
    .filter((requirement) => requirement.startsWith(MIN_VERSION_PREFIX))
    .map((requirement) => parseVersion(requirement.slice(MIN_VERSION_PREFIX.length)))
    .filter((version): version is Version => version !== null);
}

interface TokenUse {
  token: string;
  reftarget: string;
  gates: Version[];
}

function collectTokenUses(blocks: unknown[], inheritedGates: Version[], uses: TokenUse[]): void {
  for (const candidate of blocks) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }
    const block = candidate as SelectorNode;
    const gates = [...inheritedGates, ...minVersionGates(block.requirements)];

    if (typeof block.reftarget === 'string') {
      for (const token of tokensIn(block.reftarget)) {
        uses.push({ token, reftarget: block.reftarget, gates });
      }
    }
    if (Array.isArray(block.blocks)) {
      collectTokenUses(block.blocks, gates, uses);
    }
    if (Array.isArray(block.steps)) {
      collectTokenUses(block.steps, gates, uses);
    }
  }
}

interface BundledGuide {
  fileName: string;
  uses: TokenUse[];
  declaredFloor: Version;
  declaredFloorSource: string;
}

function loadGuides(): BundledGuide[] {
  return discoverBundledGuideFiles(BUNDLED_DIR).map(({ filePath, displayName }) => {
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const uses: TokenUse[] = [];
    if (Array.isArray(content.blocks)) {
      collectTokenUses(content.blocks, [], uses);
    }

    const manifestPath = path.join(path.dirname(filePath), 'manifest.json');
    const declared = fs.existsSync(manifestPath)
      ? JSON.parse(fs.readFileSync(manifestPath, 'utf-8')).testEnvironment?.minVersion
      : undefined;
    const parsed = typeof declared === 'string' ? parseVersion(declared) : null;

    return {
      fileName: displayName,
      uses,
      declaredFloor: parsed ?? PLUGIN_FLOOR,
      declaredFloorSource: parsed
        ? `testEnvironment.minVersion ${declared}`
        : `plugin floor ${formatVersion(PLUGIN_FLOOR)}`,
    };
  });
}

const guides = loadGuides().filter((guide) => guide.uses.length > 0);

describe('bundled guide grafana: selectors', () => {
  it('finds guides that use grafana: selectors', () => {
    expect(guides.length).toBeGreaterThan(0);
  });

  describe.each(guides)('$fileName', ({ uses, declaredFloor, declaredFloorSource }) => {
    it('resolves every token at the declared floor', () => {
      const unresolved = uses
        .filter(({ reftarget }) => resolveSelectorForVersion(reftarget, formatVersion(declaredFloor)) === reftarget)
        .map(({ reftarget }) => reftarget);

      expect({ unresolved }).toEqual({ unresolved: [] });
    });

    it('declares a floor that covers every token it uses', () => {
      const uncovered = uses
        .map(({ token }) => ({ token, introduced: introducedVersion(selectorPathOf(token)) }))
        .filter(({ introduced }) => introduced === null || compareVersions(introduced, declaredFloor) > 0)
        .map(({ token, introduced }) => ({
          token,
          introduced: introduced ? formatVersion(introduced) : 'no versioned selector at this path',
          declaredFloor: declaredFloorSource,
        }));

      expect({ uncovered }).toEqual({ uncovered: [] });
    });

    it('gates every token newer than the plugin floor behind min-version:', () => {
      const ungated = uses
        .map(({ token, gates }) => ({ token, gates, introduced: introducedVersion(selectorPathOf(token)) }))
        .filter(({ introduced }) => introduced !== null && compareVersions(introduced, PLUGIN_FLOOR) > 0)
        .filter(({ gates, introduced }) => !gates.some((gate) => compareVersions(gate, introduced!) >= 0))
        .map(({ token, gates, introduced }) => ({
          token,
          introduced: formatVersion(introduced!),
          pluginFloor: formatVersion(PLUGIN_FLOOR),
          gates: gates.map(formatVersion),
        }));

      expect({ ungated }).toEqual({ ungated: [] });
    });
  });
});
