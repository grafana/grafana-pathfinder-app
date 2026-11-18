/**
 * Content-file literal ratchet
 *
 * A translated guide ships as `content.<locale>.json` beside its canonical
 * `content.json` (docs/design/I18N.md §6.1), and only the canonical URL carries
 * guide identity (§6.6, "Identity rule"). Code that recognizes a guide by the
 * literal suffix `/content.json` opens a localized file as an unrelated guide
 * with its own progress and completion history, so every identity-bearing site
 * goes through `src/lib/guide-content-file.ts`.
 *
 * This guard walks the runtime files under src/ and flags every string or
 * template literal containing `/content.json` and every regular expression
 * literal naming `content.json`. The key omits the line number, so a second
 * identical literal in an allowlisted file stays grandfathered.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

import {
  ARCHITECTURE_BY_DESIGN,
  SRC_DIR,
  assertRatchet,
  collectSourceFiles,
  isTestFile,
  toPosixPath,
  validateAllowedArchitectureEntries,
  type AllowedArchitectureEntry,
} from './import-graph';

const HELPER = 'lib/guide-content-file.ts';

const ALLOWED_CONTENT_FILE_LITERALS: readonly AllowedArchitectureEntry[] = [
  {
    violation: "components/PrTester/github-api.ts — '/content.json'",
    reason:
      'Dev-only PR tester: classifies files in a pull request diff by repository path, never a guide URL a reader opens.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation:
      'components/block-editor/GitHubPRModal.tsx — `https://interactive-learning.grafana.net/${guideId}/content.json`',
    reason:
      'Block editor PR helper: writes the canonical file path into a pull request description for authors; display only.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation:
      "components/block-editor/hooks/useGuideOperations.ts — '../../../bundled-interactives/block-editor-tutorial/content.json'",
    reason: 'A module import specifier for the bundled block editor tutorial, resolved at build time; not a URL.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation:
      'docs-retrieval/content-fetcher/package-fallback-context.ts — `/packages/${encodeURIComponent(id)}/content.json`',
    reason:
      'Builds the canonical CDN URL for an offline milestone from a bare id; constructs the identity-bearing form and never matches an incoming URL.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation: "docs-retrieval/pr-package.ts — '/content.json'",
    reason:
      'Dev-only PR tester snapshot: a pull request path names the canonical file the PR edits; translated files are build output and never appear in a PR.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation: 'docs-retrieval/pr-package.ts — /content\\.json$/',
    reason: 'Dev-only PR tester snapshot: derives the sibling manifest path of the canonical file a PR edits.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation: 'docs-retrieval/pr-package.ts — `${id}/content.json`',
    reason: 'Dev-only PR tester snapshot: fetches the canonical file of a milestone in the PR.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation: 'docs-retrieval/pr-package.ts — `${manifest.id}/content.json`',
    reason: 'Dev-only PR tester snapshot: builds the canonical base URL of the path under test.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation: 'learning-paths/catalog-progress.hook.ts — `bundled:${id}/content.json`',
    reason:
      'Builds the canonical bundled launch shape. Under the identity rule the canonical URL is the one identity-bearing form, and the site never parses an incoming URL, so a localized file cannot reach it.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation: 'learning-paths/catalog-progress.hook.ts — `bundled:${item.id}/content.json`',
    reason:
      'Compares a catalog item URL with the canonical bundled launch shape that lib/package-catalog.ts builds; catalog URLs are always canonical.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation: 'lib/package-catalog.ts — `bundled:${id}/content.json`',
    reason:
      'Builds the canonical bundled launch shape. Under the identity rule the canonical URL is the one identity-bearing form, and the site never parses an incoming URL, so a localized file cannot reach it.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation: 'pages/LearningInsights/insights.helpers.ts — `bundled:${id}/content.json`',
    reason:
      'Builds the canonical bundled launch shape. Under the identity rule the canonical URL is the one identity-bearing form, and the site never parses an incoming URL, so a localized file cannot reach it.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
];

const ADVICE =
  'A literal "/content.json" match recognizes a guide by its canonical file name, so a localized ' +
  '"content.<locale>.json" URL of the same guide fails the match and opens as a different guide, ' +
  'with its own progress key and completion record (docs/design/I18N.md §6.6, "Identity rule").\n\n' +
  `Fix: use the helpers in src/${HELPER} — parseContentFileUrl, canonicalContentFileUrl, ` +
  'stripContentFile, contentFileSiblingUrl, isContentFileUrl — or CANONICAL_CONTENT_FILE / ' +
  'contentFileName() to build a file name.\n\n' +
  'Only if this site never decides guide identity (a dev tool, a display string, a fixed canonical ' +
  'build path), add an entry to ALLOWED_CONTENT_FILE_LITERALS with the reason.';

function isTextLiteral(node: ts.Node): node is ts.LiteralLikeNode {
  return (
    ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
  );
}

function enclosingTemplate(node: ts.Node): ts.Node {
  return ts.isTemplateExpression(node.parent)
    ? node.parent
    : ts.isTemplateSpan(node.parent)
      ? node.parent.parent
      : node;
}

/** The content-file literals in one module, as `<relPath> — <literal source text>`. */
function literalsIn(relPath: string, text: string): string[] {
  const source = ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    const isMatch =
      (isTextLiteral(node) && node.text.includes('/content.json')) ||
      (node.kind === ts.SyntaxKind.RegularExpressionLiteral && /content\\?\.json/.test(node.getText(source)));
    if (isMatch) {
      const literal = ts.isTemplateLiteralToken(node) ? enclosingTemplate(node) : node;
      found.push(`${relPath} — ${literal.getText(source)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function contentFileLiterals(): Set<string> {
  const found = new Set<string>();
  for (const file of collectSourceFiles()) {
    const relPath = toPosixPath(path.relative(SRC_DIR, file));
    if (!isTestFile(file) && relPath !== HELPER) {
      literalsIn(relPath, fs.readFileSync(file, 'utf-8')).forEach((key) => found.add(key));
    }
  }
  return found;
}

describe('content-file literal ratchet', () => {
  it('routes every content-file match through src/lib/guide-content-file.ts', () => {
    assertRatchet(
      contentFileLiterals(),
      new Set(ALLOWED_CONTENT_FILE_LITERALS.map((entry) => entry.violation)),
      'content-file literal',
      'ALLOWED_CONTENT_FILE_LITERALS',
      ADVICE
    );
  });

  it('gives every allowlist entry a reason and an owner', () => {
    expect(validateAllowedArchitectureEntries(ALLOWED_CONTENT_FILE_LITERALS, { allowByDesign: true })).toEqual([]);
  });

  it('recognizes string, template and regular expression literals, and ignores comments', () => {
    const sample = [
      "const a = url.endsWith('/content.json');",
      'const b = `${base}/content.json`;',
      'const c = url.replace(/\\/content\\.json$/, "");',
      '// a comment naming /content.json is not code',
      'const d = parseContentFileUrl(url);',
    ].join('\n');

    expect(literalsIn('sample.ts', sample)).toEqual([
      "sample.ts — '/content.json'",
      'sample.ts — `${base}/content.json`',
      'sample.ts — /\\/content\\.json$/',
    ]);
  });
});
