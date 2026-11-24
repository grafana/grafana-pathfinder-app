/**
 * Docs URL-family literal ratchet
 *
 * Which family a docs URL belongs to (a legacy learning path or journey, a
 * tutorial, Grafana Learn) is decided in one place, `src/lib/docs-url-family.ts`
 * (docs/design/GRAFANA_LEARN.md). A hand-written predicate elsewhere drifts from
 * it: the eight copies this guard replaced disagreed on `startsWith` against
 * `includes`, on query strings, and on whether `/tutorials/` counted. Grafana
 * Learn would have been the ninth blind spot.
 *
 * This guard walks the runtime files under src/ and flags every string or
 * template literal naming a family path (`/learning-journeys`, `/learning-paths`,
 * `/learning-hub`, `/tutorials/`) and every regular expression literal naming a
 * family segment or `milestone-N`. The key omits the line number, so a second
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

const CLASSIFIER = 'lib/docs-url-family.ts';
const GRAFANA_LEARN_JOURNEY_ISSUE = '#2512';

const ALLOWED_FAMILY_LITERALS: readonly AllowedArchitectureEntry[] = [
  {
    violation: 'components/AppConfig/ConfigurationForm.tsx — "https://grafana.com/docs/learning-paths/..."',
    reason: 'Placeholder text in a settings input; displays an example URL and decides nothing.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation:
      "components/LearningContentCard/learning-previews.ts — 'https://grafana.com/docs/learning-paths/drilldown-logs/'",
    reason: 'Sample card data: a literal journey URL to display, not a test of one.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation:
      "components/LearningContentCard/learning-previews.ts — 'https://grafana.com/docs/learning-paths/drilldown-metrics/'",
    reason: 'Sample card data: a literal journey URL to display, not a test of one.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation:
      "components/LearningContentCard/learning-previews.ts — 'https://grafana.com/docs/learning-paths/drilldown-traces/'",
    reason: 'Sample card data: a literal journey URL to display, not a test of one.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation:
      "components/LearningContentCard/learning-previews.ts — 'https://grafana.com/docs/learning-paths/infrastructure-alerting/'",
    reason: 'Sample card data: a literal journey URL to display, not a test of one.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation:
      "components/LearningContentCard/learning-previews.ts — 'https://grafana.com/docs/learning-paths/linux-server-integration/understand-dashboards/'",
    reason: 'Sample card data: a literal journey URL to display, not a test of one.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation:
      "components/LearningContentCard/learning-previews.ts — 'https://grafana.com/docs/learning-paths/send-logs-alloy-loki/view-logs/'",
    reason: 'Sample card data: a literal journey URL to display, not a test of one.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation:
      "components/LearningContentCard/learning-previews.ts — 'https://grafana.com/docs/learning-paths/visualization-logs/'",
    reason: 'Sample card data: a literal journey URL to display, not a test of one.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation:
      "components/LearningContentCard/learning-previews.ts — 'https://grafana.com/docs/learning-paths/visualization-metrics/'",
    reason: 'Sample card data: a literal journey URL to display, not a test of one.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation: "components/docs-panel/link-handler.hook.ts — '/tutorials/'",
    reason:
      'Analytics link-type label for root `/tutorials/` links only, deliberately narrower than the tutorial family; the routing decision beside it uses isLearningJourneyUrl.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation: "context-engine/context.service.ts — 'https://grafana.com/docs/learning-journeys'",
    reason:
      'Whole-URL denylist of the two bare index pages that the recommender must not surface; matches exact URLs, never a family.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation: "context-engine/context.service.ts — 'https://grafana.com/docs/learning-journeys/'",
    reason:
      'Whole-URL denylist of the two bare index pages that the recommender must not surface; matches exact URLs, never a family.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation: "context-engine/context.service.ts — 'https://grafana.com/docs/learning-paths'",
    reason:
      'Whole-URL denylist of the two bare index pages that the recommender must not surface; matches exact URLs, never a family.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation: "context-engine/context.service.ts — 'https://grafana.com/docs/learning-paths/'",
    reason:
      'Whole-URL denylist of the two bare index pages that the recommender must not surface; matches exact URLs, never a family.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation: 'docs-retrieval/content-fetcher/metadata-extract.ts — /\\/milestone-(\\d+)/',
    reason:
      'Reads the milestone number out of a legacy milestone URL to find the current position; the Learn journey resolver replaces position lookup.',
    tracking: GRAFANA_LEARN_JOURNEY_ISSUE,
  },
  {
    violation:
      'docs-retrieval/content-fetcher/package-content.ts — `https://grafana.com/docs/learning-paths/${pathSlug}/${slug}/`',
    reason:
      'Builds a legacy milestone website URL from a package id; constructs a URL and never matches an incoming one.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation:
      'docs-retrieval/content-fetcher/package-content.ts — `https://grafana.com/docs/learning-paths/${pathSlug}/`',
    reason:
      'Builds a legacy journey website URL from a package id; constructs a URL and never matches an incoming one.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation: 'lib/learning-journey-url.ts — /\\/milestone-\\d+.*$/',
    reason:
      'Text fallback that strips a `/milestone-N` tail when the classifier yields no journey base (a milestone outside the journey roots, or a URL that is not http(s)); a string operation, not a family decision.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation: "security/url-validator.ts — '/docs/learning-journeys/'",
    reason:
      'The trust gate: which grafana.com paths may be fetched. It authorizes and does not route, and must not depend on the classifier it protects.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation: "security/url-validator.ts — '/docs/learning-paths/'",
    reason:
      'The trust gate: which grafana.com paths may be fetched. It authorizes and does not route, and must not depend on the classifier it protects.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation: "security/url-validator.ts — '/tutorials/'",
    reason:
      'The trust gate: which grafana.com paths may be fetched. It authorizes and does not route, and must not depend on the classifier it protects.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation: "utils/find-doc-page.ts — '/docs/learning-journeys/'",
    reason:
      'Accepts a relative `?doc=` path as a docs page and types it; moves onto the classifier when Learn journeys open.',
    tracking: GRAFANA_LEARN_JOURNEY_ISSUE,
  },
  {
    violation: "utils/find-doc-page.ts — '/docs/learning-paths/'",
    reason:
      'Accepts a relative `?doc=` path as a docs page and types it; moves onto the classifier when Learn journeys open.',
    tracking: GRAFANA_LEARN_JOURNEY_ISSUE,
  },
  {
    violation: "utils/find-doc-page.ts — '/tutorials/'",
    reason:
      'Accepts a relative `?doc=` path as a docs page and types it; moves onto the classifier when Learn journeys open.',
    tracking: GRAFANA_LEARN_JOURNEY_ISSUE,
  },
];

const ADVICE =
  'A hand-written test for a docs URL family (a path that contains "/learning-paths/", "/tutorials/", ' +
  'a "milestone-N" segment, or the Grafana Learn root) can disagree with the classifier on query strings, ' +
  'host and path depth, and it cannot see Grafana Learn at all.\n\n' +
  `Fix: call classifyDocsUrl from src/${CLASSIFIER} and read the family, or use isLegacyJourneyFamily / ` +
  'isJourneyContent. Add a family or a field there if the decision you need is missing.\n\n' +
  'Only if the literal is not a routing or content decision (a trust-gate prefix, a URL being built, display ' +
  'text, sample data), add an entry to ALLOWED_FAMILY_LITERALS with the reason.';

const FAMILY_PATH_LITERAL = /\/(?:learning-journeys|learning-paths|learning-hub)\b|\/tutorials\//;
const FAMILY_REGEX_LITERAL = /learning-journeys|learning-paths|learning-hub|tutorials|milestone-/;

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

/** A module specifier (`import`, `export … from`, `require`, dynamic `import()`) names a directory, not a URL. */
function isModuleSpecifier(node: ts.Node): boolean {
  const parent = node.parent;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent)) {
    return true;
  }
  if (ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent)) {
    return true;
  }
  return (
    ts.isCallExpression(parent) &&
    (parent.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(parent.expression) && parent.expression.text === 'require'))
  );
}

/** The docs URL-family literals in one module, as `<relPath> — <literal source text>`. */
function literalsIn(relPath: string, text: string): string[] {
  const source = ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    const isMatch =
      (isTextLiteral(node) && !isModuleSpecifier(node) && FAMILY_PATH_LITERAL.test(node.text)) ||
      (node.kind === ts.SyntaxKind.RegularExpressionLiteral && FAMILY_REGEX_LITERAL.test(node.getText(source)));
    if (isMatch) {
      const literal = ts.isTemplateLiteralToken(node) ? enclosingTemplate(node) : node;
      found.push(`${relPath} — ${literal.getText(source)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function familyLiterals(): Set<string> {
  const found = new Set<string>();
  for (const file of collectSourceFiles()) {
    const relPath = toPosixPath(path.relative(SRC_DIR, file));
    if (!isTestFile(file) && relPath !== CLASSIFIER) {
      literalsIn(relPath, fs.readFileSync(file, 'utf-8')).forEach((key) => found.add(key));
    }
  }
  return found;
}

describe('docs URL-family literal ratchet', () => {
  it('routes every family decision through src/lib/docs-url-family.ts', () => {
    assertRatchet(
      familyLiterals(),
      new Set(ALLOWED_FAMILY_LITERALS.map((entry) => entry.violation)),
      'docs URL-family literal',
      'ALLOWED_FAMILY_LITERALS',
      ADVICE
    );
  });

  it('gives every allowlist entry a reason and an owner', () => {
    expect(validateAllowedArchitectureEntries(ALLOWED_FAMILY_LITERALS, { allowByDesign: true })).toEqual([]);
  });

  it('flags string, template and regular expression literals, and ignores comments', () => {
    const sample = [
      "const a = pathname.includes('/docs/learning-paths/');",
      'const b = `https://grafana.com/docs/learning-journeys/${slug}/`;',
      'const c = url.replace(/\\/milestone-\\d+.*$/, "");',
      "const d = pathname.startsWith('/tutorials/');",
      "const e = url.startsWith('/docs/learning-hub/');",
      '// a comment naming /learning-paths/ is not code',
      "const f = source === 'learning-hub';",
      "import data from '../learning-paths/data.json';",
      'const g = classifyDocsUrl(url);',
    ].join('\n');

    expect(literalsIn('sample.ts', sample)).toEqual([
      "sample.ts — '/docs/learning-paths/'",
      'sample.ts — `https://grafana.com/docs/learning-journeys/${slug}/`',
      'sample.ts — /\\/milestone-\\d+.*$/',
      "sample.ts — '/tutorials/'",
      "sample.ts — '/docs/learning-hub/'",
    ]);
  });
});
