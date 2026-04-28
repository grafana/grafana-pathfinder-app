#!/usr/bin/env node
/**
 * Generates the public-facing terms and conditions page from the in-app
 * source of truth.
 *
 * Source : src/components/AppConfig/terms-content.ts (TERMS_AND_CONDITIONS_CONTENT)
 *          src/constants.ts                          (TERMS_VERSION)
 * Target : docs/sources/terms-and-conditions/_index.md
 *
 * Why a generator (vs. a hand-maintained markdown file):
 * The plugin's settings page renders the HTML from `terms-content.ts`
 * verbatim. If the docs page were authored separately the two would drift
 * silently — and the legal/privacy text is exactly the kind of content
 * where drift is a problem. Treating the docs page as a derived artifact
 * keeps a single source of truth.
 *
 * Usage:
 *   node scripts/sync-terms-and-conditions.js          # write/refresh the file
 *   node scripts/sync-terms-and-conditions.js --check  # exit 1 if out of date
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const TERMS_TS = path.join(root, 'src', 'components', 'AppConfig', 'terms-content.ts');
const CONSTANTS_TS = path.join(root, 'src', 'constants.ts');
const TARGET_DIR = path.join(root, 'docs', 'sources', 'terms-and-conditions');
const TARGET = path.join(TARGET_DIR, '_index.md');

/**
 * Pull the contents of TERMS_AND_CONDITIONS_CONTENT — the value of the
 * exported template literal — out of `terms-content.ts`. Anchored on the
 * exact identifier to avoid matching unrelated template strings if the file
 * grows.
 */
function readTermsHtml() {
  const src = fs.readFileSync(TERMS_TS, 'utf8');
  const match = src.match(/export\s+const\s+TERMS_AND_CONDITIONS_CONTENT\s*=\s*`([\s\S]*?)`;/);
  if (!match) {
    throw new Error(
      `Could not locate \`export const TERMS_AND_CONDITIONS_CONTENT = \`...\`;\` in ${TERMS_TS}. ` +
        `Did the source file shape change? Update sync-terms-and-conditions.js to match.`
    );
  }
  return match[1].trim();
}

function readTermsVersion() {
  const src = fs.readFileSync(CONSTANTS_TS, 'utf8');
  const match = src.match(/export\s+const\s+TERMS_VERSION\s*=\s*['"]([^'"]+)['"]\s*;/);
  if (!match) {
    throw new Error(`Could not locate \`export const TERMS_VERSION = '...';\` in ${CONSTANTS_TS}.`);
  }
  return match[1];
}

/**
 * Convert the (small, hand-controlled) HTML subset used in the T&C string
 * to markdown.
 *
 * Supported tags: <h2>, <h3>, <p>, <ul>, <li>, <strong>, <em>, <code>,
 * <a href="...">, <hr/>.
 *
 * Anything outside this set causes the script to throw — silent data loss
 * (e.g. dropping a <table>, mangling a nested list) is much worse than a
 * loud build failure that prompts the dev to extend this converter.
 *
 * `<hr/>` is also our docs/in-app boundary: the source string ends with an
 * <hr/> followed by an in-app instruction ("…using the following toggle.")
 * that has no meaning in the standalone docs page. We drop everything from
 * the first <hr/> onward.
 */
function htmlToMarkdown(html) {
  const hrIndex = html.search(/<hr\s*\/?>/i);
  const body = hrIndex >= 0 ? html.slice(0, hrIndex) : html;

  let md = body;

  // Block elements. Replace headings and paragraphs with newline-padded
  // markdown so consecutive blocks render as separate paragraphs.
  md = md.replace(/<h2>([\s\S]*?)<\/h2>/g, (_, c) => `\n## ${convertInline(c.trim())}\n`);
  md = md.replace(/<h3>([\s\S]*?)<\/h3>/g, (_, c) => `\n### ${convertInline(c.trim())}\n`);
  md = md.replace(/<p>([\s\S]*?)<\/p>/g, (_, c) => `\n${convertInline(c.trim())}\n`);

  md = md.replace(/<ul>([\s\S]*?)<\/ul>/g, (_, items) => {
    const liMatches = [...items.matchAll(/<li>([\s\S]*?)<\/li>/g)];
    if (liMatches.length === 0) {
      return '';
    }
    const lines = liMatches.map((m) => `- ${convertInline(m[1].trim())}`);
    return `\n${lines.join('\n')}\n`;
  });

  // Trim, collapse 3+ blank lines, and ensure a trailing newline.
  md = md
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  assertNoLingeringTags(md);
  return md;
}

function convertInline(s) {
  let out = s
    .replace(/<strong>([\s\S]*?)<\/strong>/g, '**$1**')
    .replace(/<em>([\s\S]*?)<\/em>/g, '*$1*')
    .replace(/<code>([\s\S]*?)<\/code>/g, '`$1`')
    .replace(/<a\s+href="([^"]+)">([\s\S]*?)<\/a>/g, '[$2]($1)');

  // Collapse runs of whitespace introduced by line breaks inside tags, but
  // keep single-newline boundaries intact in case the caller relies on them.
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

function assertNoLingeringTags(md) {
  // Anything that still looks like an HTML tag is a converter gap. Surface
  // it now rather than letting it ship into the docs.
  const stray = md.match(/<\/?[a-zA-Z][^>]*>/);
  if (stray) {
    throw new Error(
      `Unsupported HTML tag survived conversion: ${stray[0]}.\n` +
        `Add support for it in scripts/sync-terms-and-conditions.js or remove it from terms-content.ts.`
    );
  }
}

function buildMarkdown({ termsHtml, termsVersion }) {
  const body = htmlToMarkdown(termsHtml);
  const frontmatter = [
    '---',
    'title: Terms and conditions',
    'menuTitle: Terms and conditions',
    "description: Data usage notice for Interactive learning's context-aware recommendations.",
    'weight: 50',
    '---',
  ].join('\n');

  const generatedNotice = [
    '<!--',
    'DO NOT EDIT BY HAND.',
    'This page is generated from src/components/AppConfig/terms-content.ts',
    'by scripts/sync-terms-and-conditions.js. Update the source file and run',
    '`npm run docs:sync-terms` to refresh this page.',
    '-->',
  ].join('\n');

  const heading = '# Terms and conditions';
  const versionLine = `**Version:** ${termsVersion}`;
  const intro =
    'This page is the data usage notice that Interactive learning shows in the plugin configuration ' +
    'when an administrator enables context-aware recommendations. It is reproduced here so it is ' +
    'reviewable outside Grafana.';

  return [frontmatter, '', generatedNotice, '', heading, '', versionLine, '', intro, '', body, ''].join('\n');
}

function main() {
  const checkMode = process.argv.includes('--check');

  const termsHtml = readTermsHtml();
  const termsVersion = readTermsVersion();
  const generated = buildMarkdown({ termsHtml, termsVersion });

  if (checkMode) {
    if (!fs.existsSync(TARGET)) {
      console.error(`docs:sync-terms check failed: ${path.relative(root, TARGET)} does not exist.`);
      console.error('Run `npm run docs:sync-terms` and commit the result.');
      process.exit(1);
    }
    const existing = fs.readFileSync(TARGET, 'utf8');
    if (existing !== generated) {
      console.error(`docs:sync-terms check failed: ${path.relative(root, TARGET)} is out of date.`);
      console.error('Run `npm run docs:sync-terms` and commit the result.');
      process.exit(1);
    }
    console.log(`docs:sync-terms ok (${path.relative(root, TARGET)} matches source, version ${termsVersion}).`);
    return;
  }

  fs.mkdirSync(TARGET_DIR, { recursive: true });
  fs.writeFileSync(TARGET, generated);
  console.log(`Wrote ${path.relative(root, TARGET)} (terms version ${termsVersion}).`);
}

main();
