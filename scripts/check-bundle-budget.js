const fs = require('node:fs');

const ENTRY_BUDGET_BYTES = 100_000;

function checkBundleBudget(stats) {
  if (stats.errors?.length) {
    throw new Error('Cannot check the bundle budget: webpack reported build errors');
  }
  const entries = Object.values(stats.entrypoints ?? {});
  if (!entries.length) {
    throw new Error('Cannot check the bundle budget: no entrypoints found');
  }
  const assets = new Map();
  for (const entry of entries) {
    for (const asset of entry.assets ?? []) {
      if (!/\.js(?:\?|$)/.test(asset.name)) {
        continue;
      }
      if (!Number.isFinite(asset.size) || asset.size < 0) {
        throw new Error(`Missing or invalid size for ${asset.name}`);
      }
      assets.set(asset.name, asset.size);
    }
  }
  if (!assets.size) {
    throw new Error('Cannot check the bundle budget: no initial JavaScript assets found');
  }
  const bytes = [...assets.values()].reduce((total, size) => total + size, 0);
  if (bytes >= ENTRY_BUDGET_BYTES) {
    throw new Error(`Initial JavaScript is ${bytes} bytes; must be below ${ENTRY_BUDGET_BYTES} bytes`);
  }
  return bytes;
}

if (require.main === module) {
  try {
    const stats = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    console.log(`Initial JavaScript: ${checkBundleBudget(stats)} bytes (budget: <${ENTRY_BUDGET_BYTES})`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { checkBundleBudget };
