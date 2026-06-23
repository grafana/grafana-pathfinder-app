const fs = require('fs');
const path = require('path');

const reportsDir = 'all-reports';

function readSummary(file) {
  const content = fs.readFileSync(file, 'utf8');
  const value = (key) => (content.match(new RegExp(`^${key}=(.*)$`, 'm')) || [])[1]?.trim() || '';
  return {
    image: value('GRAFANA_IMAGE'),
    version: value('GRAFANA_VERSION'),
    outcome: value('OUTPUT'),
  };
}

function main() {
  if (!fs.existsSync(reportsDir) || !fs.statSync(reportsDir).isDirectory()) {
    console.error(`No reports directory found at "${reportsDir}"`);
    process.exit(1);
  }

  const rows = fs
    .readdirSync(reportsDir)
    .map((entry) => path.join(reportsDir, entry, 'summary.txt'))
    .filter((file) => fs.existsSync(file))
    .map(readSummary)
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))
    .map(({ image, version, outcome }) => `| ${image} | ${version} | ${outcome === 'success' ? '✅' : '❌'} |`);

  const table = [
    '### Playwright test results',
    '| Image name | Version | Result |',
    '|:---------- |:------- |:------: |',
    ...rows,
  ].join('\n');

  console.log(table);
}

main();
