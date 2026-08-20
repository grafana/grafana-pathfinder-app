/**
 * Grafana's plugin provisioner **replaces** `jsonData` on every startup with
 * whatever the provisioning file says. A file that declares an app but omits
 * `jsonData:` therefore wipes every setting an operator saved through the UI,
 * on every restart — silently, and looking exactly like a save bug in the
 * plugin.
 *
 * The asymmetry is the trap, from
 * grafana/pkg/services/pluginsintegration/pluginsettings/service/service.go:
 *
 *   for key, encryptedData := range cmd.EncryptedSecureJsonData {
 *     pluginSetting.SecureJsonData[key] = encryptedData   // merged
 *   }
 *   ...
 *   pluginSetting.JsonData = cmd.JsonData                 // replaced
 *
 * so a secret survives a restart while the settings beside it do not.
 *
 * Every app plugin in this dev stack sets `autoEnabled: true`, which Grafana
 * honours with no settings row at all (`pkg/api/bootdata.go`), and the
 * provisioner refuses outright to disable an auto-enabled plugin
 * (`ErrPluginProvisioningAutoEnabled`). So an entry can only ever restate what
 * the plugin already does, at the cost of the operator's settings. There is no
 * legitimate app entry to write here, which is why this test bans all of them
 * rather than just insisting on a `jsonData` key.
 */

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** Anywhere a file could be mounted into Grafana's provisioning directory. */
const SEARCH_DIRS = ['provisioning/plugins', 'demo', 'provisioning'];

function provisioningYamlFiles(): string[] {
  const found: string[] = [];
  for (const dir of SEARCH_DIRS) {
    const abs = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(abs)) {
      continue;
    }
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.isFile() && /\.ya?ml$/.test(entry.name)) {
        found.push(path.join(dir, entry.name));
      }
    }
  }
  return [...new Set(found)];
}

/**
 * A YAML `apps:` sequence entry, ignoring comments. Deliberately textual rather
 * than a YAML parse: the point is to catch a line someone adds, including one
 * added inside a block that a parser would skip.
 */
function declaresAppEntry(source: string): boolean {
  const lines = source.split('\n').filter((line) => !line.trim().startsWith('#'));
  const appsAt = lines.findIndex((line) => /^apps:\s*$/.test(line.trim()) || /^apps:\s*\[\s*\]\s*$/.test(line.trim()));
  if (appsAt === -1) {
    return false;
  }
  // An inline `apps: []` declares nothing.
  if (/^apps:\s*\[\s*\]\s*$/.test(lines[appsAt]!.trim())) {
    return false;
  }
  return lines.slice(appsAt + 1).some((line) => /^\s*-\s/.test(line));
}

describe('plugin provisioning does not wipe saved settings', () => {
  it('finds the provisioning files it is meant to be guarding', () => {
    // A rename that moved these out from under the test would otherwise make it
    // vacuously green.
    expect(provisioningYamlFiles()).toContain('provisioning/plugins/app.yaml');
  });

  it.each(provisioningYamlFiles())('%s declares no app entry', (relative) => {
    const source = fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');

    expect(declaresAppEntry(source)).toBe(false);
  });

  it('recognises an app entry when there is one', () => {
    // Guards the detector itself: a test that cannot fail proves nothing.
    const offending = ['apiVersion: 1', 'apps:', "  - type: 'grafana-pathfinder-app'", '    disabled: false'].join(
      '\n'
    );

    expect(declaresAppEntry(offending)).toBe(true);
  });

  it('does not mistake a commented-out entry for a live one', () => {
    const commented = ['apiVersion: 1', '# apps:', "#   - type: 'grafana-pathfinder-app'", 'apps: []'].join('\n');

    expect(declaresAppEntry(commented)).toBe(false);
  });
});
