#!/usr/bin/env node
/**
 * Copies bundled-interactives JSON files to pkg/static/ for Go embed.
 *
 * go:embed cannot traverse ../.. so we copy the files into the pkg/ tree first.
 * Run this before any Go build that uses embedded static data.
 *
 * Usage: node scripts/copy-static.js
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'src', 'bundled-interactives');
const destDir = path.join(root, 'pkg', 'plugin', 'static');

// Ensure destination directories exist
fs.mkdirSync(path.join(destDir, 'guides'), { recursive: true });

// Copy repository.json
const repoSrc = path.join(srcDir, 'repository.json');
const repoDest = path.join(destDir, 'repository.json');
fs.copyFileSync(repoSrc, repoDest);
console.log(`Copied repository.json → pkg/plugin/static/repository.json`);

// Copy each guide's content.json
let guideCount = 0;
const entries = fs.readdirSync(srcDir, { withFileTypes: true });
for (const entry of entries) {
  if (!entry.isDirectory()) {
    continue;
  }
  const contentSrc = path.join(srcDir, entry.name, 'content.json');
  if (!fs.existsSync(contentSrc)) {
    continue;
  }
  const contentDest = path.join(destDir, 'guides', `${entry.name}.json`);
  fs.copyFileSync(contentSrc, contentDest);
  guideCount++;
}
console.log(`Copied ${guideCount} guide content.json files → pkg/plugin/static/guides/`);
