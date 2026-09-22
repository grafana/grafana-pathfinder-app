/**
 * App Platform transport ratchet
 *
 * Reads of App Platform resources must be proxied through the plugin backend
 * (an on-behalf-of route, per docs/design/BACKEND_PROXY_PATTERN.md), never
 * issued directly from the browser. Pathfinder 2.18.0 broke this way for
 * anonymous Play viewers (incident 5857): Play's anonymous Viewer role
 * advertises permission to read tenant settings and custom guides, but the
 * storage layer's delegated service-token check rejects a direct anonymous
 * read (service_allowed=false) before it ever evaluates the caller's own
 * rights, so the read 403s and the plugin fails to initialize. The fix
 * (#1966) proxied settings and single-guide reads the same way the guide
 * catalogue already was; administrative writes deliberately stayed direct,
 * riding App Platform's own optimistic-concurrency checks.
 *
 * This test walks every getBackendSrv().fetch/request/get/post(...) call site
 * under src/ and flags one whose url addresses App Platform (a literal,
 * template, or concatenation containing "/apis/", or reaching a call to the
 * collectionUrl/itemUrl builders in utils/interactive-guides-api.ts or
 * utils/pathfinder-settings-api.ts) unless the resolved HTTP method is a
 * mutation (POST/PUT/PATCH/DELETE) or the call site is allowlisted. The
 * receiver may be the inline getBackendSrv() call or a same-scope variable
 * holding it. Ratchet mechanism per import-graph.ts: the allowlist
 * can only shrink, and a call this guard cannot resolve with confidence is
 * reported rather than passed silently.
 *
 * Landed with two pre-existing violations grandfathered into
 * ALLOWED_DIRECT_APP_PLATFORM_READS below — the same failure mode as
 * incident 5857, still unfixed on main. Paying those down is tracked in
 * https://github.com/grafana/grafana-pathfinder-app/issues/1975; no new
 * violation can land on top of them.
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
  resolveImportToFileNode,
  toPosixPath,
  validateAllowedArchitectureEntries,
  type AllowedArchitectureEntry,
} from './import-graph';

// ---------------------------------------------------------------------------
// The allowlist — the ratchet baseline (see #1975 for the pay-down plan)
// ---------------------------------------------------------------------------

/**
 * Baseline grandfathered when this ratchet landed. Both entries are real,
 * pre-existing defects — the same failure mode as incident 5857 — not
 * tolerated design choices; each silently returns an empty guide list to an
 * anonymous viewer instead of failing visibly. Pay down separately, one PR
 * per entry (see #1975): fixing either removes its own entry here, and the
 * ratchet enforces that by failing on a stale entry that no longer matches
 * a real violation.
 */
const ALLOWED_DIRECT_APP_PLATFORM_READS: readonly AllowedArchitectureEntry[] = [
  {
    violation: 'context-engine/context.init.ts — GET collectionUrl(namespace)',
    reason:
      'Pre-existing defect (not a design choice): fetches the interactive-guides collection directly at ' +
      "plugin start, but nothing reads the response — the call's original purpose needs to be established " +
      'before it is deleted or re-pointed at a proxy. Same failure mode as incident 5857 — an anonymous ' +
      "viewer's read fails the storage layer's delegated service-token check and 403s — except here the " +
      '403 is swallowed as "endpoint not rolled out yet," so the failure is invisible.',
    tracking: '#1975',
  },
  {
    violation: 'utils/fetchBackendGuides.ts — GET collectionUrl(namespace)',
    reason:
      'Pre-existing defect (not a design choice): a direct read of the interactive-guides collection, the ' +
      "same failure mode as incident 5857. An anonymous viewer's read fails the storage layer's delegated " +
      'service-token check and 403s; this call swallows that 403 as "endpoint not rolled out yet" and ' +
      'returns an empty list, so the anonymous visitor sees no custom guides and no error. A proxied ' +
      'equivalent already exists (fetchCustomGuideRepository in src/lib/custom-guide-repository-client.ts) ' +
      'and is the likely fix.',
    tracking: '#1975',
  },
];

const ADVICE =
  'A direct browser read of App Platform ("/apis/..." — or the shared collectionUrl/itemUrl ' +
  'builders in src/utils/interactive-guides-api.ts and src/utils/pathfinder-settings-api.ts) must ' +
  'be proxied through the plugin backend instead of being issued from the browser.\n\n' +
  'Why: Pathfinder 2.18.0 broke for anonymous Play viewers this way (incident 5857, fixed by ' +
  "github.com/grafana/grafana-pathfinder-app/pull/1966). Play's anonymous Viewer role advertises " +
  "permission to read these resources, but the storage layer's delegated service-token check " +
  "rejects a direct anonymous read (service_allowed=false) before it ever evaluates the caller's " +
  'own rights — so the read 403s and the plugin fails to initialize. A plugin-backend proxy avoids ' +
  'that check entirely by minting a caller-scoped on-behalf-of token server-side.\n\n' +
  'Fix: add (or reuse) a GET route on the plugin backend — a proxy at `${PLUGIN_BACKEND_URL}/<route>` ' +
  '— and read through it instead of calling getBackendSrv() directly. For a guide list specifically, ' +
  'reuse fetchCustomGuideRepository in src/lib/custom-guide-repository-client.ts, which already ' +
  'proxies this read correctly. See docs/design/BACKEND_PROXY_PATTERN.md for the full pattern.\n\n' +
  'Administrative WRITES are a deliberate exception: a resolved PUT/POST/PATCH/DELETE stays on the ' +
  'direct App Platform API with its own optimistic-concurrency checks (see ' +
  'docs/design/BACKEND_PROXY_PATTERN.md, "Singleton settings reads") and is never flagged here.\n\n' +
  'Only if this specific read is a deliberate, reviewed exception, add an entry to ' +
  'ALLOWED_DIRECT_APP_PLATFORM_READS with a substantive reason and a tracking issue — a sibling ' +
  'test requires both, so an empty rubber-stamp will not pass.';

// ---------------------------------------------------------------------------
// Builder-call recognition: which local names are collectionUrl/itemUrl —
// imported from one of the two files that legitimately construct App Platform
// URLs, or declared in that file itself (pathfinder-settings-api.ts calls its
// own builders, so recognizing only importers would leave the builder modules
// as blind spots)
// ---------------------------------------------------------------------------

const BUILDER_MODULES = new Set(['utils/interactive-guides-api.ts', 'utils/pathfinder-settings-api.ts']);

const GET_BACKEND_SRV_METHOD_NAMES = new Set(['fetch', 'request', 'get', 'post']);
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface BuilderNames {
  collectionUrlNames: Set<string>;
  itemUrlNames: Set<string>;
}

function declaredNames(stmt: ts.Statement): string[] {
  if (ts.isFunctionDeclaration(stmt)) {
    return stmt.name ? [stmt.name.text] : [];
  }
  if (ts.isVariableStatement(stmt)) {
    return stmt.declarationList.declarations
      .filter((decl) => ts.isIdentifier(decl.name))
      .map((decl) => (decl.name as ts.Identifier).text);
  }
  return [];
}

function findBuilderNames(sourceFile: ts.SourceFile, fileDir: string, relPath: string): BuilderNames {
  const collectionUrlNames = new Set<string>();
  const itemUrlNames = new Set<string>();

  const record = (builder: string, localName: string): void => {
    if (builder === 'collectionUrl') {
      collectionUrlNames.add(localName);
    } else if (builder === 'itemUrl') {
      itemUrlNames.add(localName);
    }
  };

  for (const stmt of sourceFile.statements) {
    if (BUILDER_MODULES.has(relPath)) {
      for (const name of declaredNames(stmt)) {
        record(name, name);
      }
    }
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteralLike(stmt.moduleSpecifier)) {
      continue;
    }
    const specifier = stmt.moduleSpecifier.text;
    if (!specifier.startsWith('.')) {
      continue;
    }
    const resolved = resolveImportToFileNode(fileDir, specifier);
    if (!resolved || !BUILDER_MODULES.has(resolved)) {
      continue;
    }
    const clause = stmt.importClause;
    if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) {
      continue;
    }
    for (const element of clause.namedBindings.elements) {
      record((element.propertyName ?? element.name).text, element.name.text);
    }
  }

  return { collectionUrlNames, itemUrlNames };
}

// ---------------------------------------------------------------------------
// Call-site discovery: getBackendSrv().fetch/request/get/post(...)
//
// The receiver is either the inline getBackendSrv() call or a same-scope
// variable holding it (`const backendSrv = getBackendSrv()`), resolved through
// the same single-file declaration lookup the url and request bag already use.
// ---------------------------------------------------------------------------

interface CandidateCall {
  node: ts.CallExpression;
  methodName: 'fetch' | 'request' | 'get' | 'post';
}

function isGetBackendSrvCall(expr: ts.Expression): boolean {
  return ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === 'getBackendSrv';
}

function isGetBackendSrvInvocation(expr: ts.Expression, blocks: readonly ts.Node[]): boolean {
  if (isGetBackendSrvCall(expr)) {
    return true;
  }
  if (!ts.isIdentifier(expr)) {
    return false;
  }
  const initializer = resolveLocalDeclarationInitializer(expr.text, blocks);
  return initializer !== null && isGetBackendSrvCall(initializer);
}

function findCandidateCalls(sourceFile: ts.SourceFile): CandidateCall[] {
  const results: CandidateCall[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      GET_BACKEND_SRV_METHOD_NAMES.has(node.expression.name.text) &&
      isGetBackendSrvInvocation(node.expression.expression, collectScopeBlocks(node, sourceFile))
    ) {
      results.push({ node, methodName: node.expression.name.text as CandidateCall['methodName'] });
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return results;
}

// ---------------------------------------------------------------------------
// Same-scope variable resolution
//
// Bounded, single-file resolution only: walk from the call site up through
// enclosing blocks (function bodies) to the module top level, looking for a
// `const`/`let` declaration with a matching name. This resolves the two
// documented shapes — a request object hoisted in the same function
// (pathfinder-settings-api.ts's `request`), and a module-level URL constant
// (completion-write-client.ts's `WRITE_URL`) — without chasing imports or
// callers across files.
// ---------------------------------------------------------------------------

function collectScopeBlocks(node: ts.Node, sourceFile: ts.SourceFile): ts.Node[] {
  const blocks: ts.Node[] = [];
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isBlock(current)) {
      blocks.push(current);
    }
    current = current.parent;
  }
  blocks.push(sourceFile);
  return blocks;
}

function statementsOf(block: ts.Node): readonly ts.Statement[] {
  return ts.isBlock(block) || ts.isSourceFile(block) ? block.statements : [];
}

function resolveLocalDeclarationInitializer(name: string, blocks: readonly ts.Node[]): ts.Expression | null {
  for (const block of blocks) {
    for (const stmt of statementsOf(block)) {
      if (!ts.isVariableStatement(stmt)) {
        continue;
      }
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name && decl.initializer) {
          return decl.initializer;
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// url classification
//
// Terminates in a binary decision (addresses App Platform, or not) rather
// than ever reporting "unresolved" on its own. An identifier that cannot be
// traced to a local declaration (a function parameter, e.g.
// gcx-service-account.ts's `readJson(url)`, or a cross-file import) fails
// both positive-match criteria by construction — it is not a literal/template
// containing "/apis/", and it is not a call to collectionUrl/itemUrl — so it
// is a confident negative. "Cannot resolve with confidence" is instead
// enforced one level up, at the request-BAG resolution for .fetch() below:
// that is the shape the precision requirements actually describe (a request
// object hoisted into a variable), and is where this guard truly cannot see
// the call site if resolution fails.
// ---------------------------------------------------------------------------

interface UrlClassification {
  appPlatform: boolean;
  text: string;
}

function classifyUrl(expr: ts.Expression, builders: BuilderNames, blocks: readonly ts.Node[]): UrlClassification {
  let e: ts.Expression = expr;
  while (ts.isParenthesizedExpression(e)) {
    e = e.expression;
  }

  if (ts.isConditionalExpression(e)) {
    const whenTrue = classifyUrl(e.whenTrue, builders, blocks);
    const whenFalse = classifyUrl(e.whenFalse, builders, blocks);
    return { appPlatform: whenTrue.appPlatform || whenFalse.appPlatform, text: e.getText() };
  }

  if (ts.isStringLiteralLike(e)) {
    return { appPlatform: e.text.includes('/apis/'), text: e.getText() };
  }

  if (ts.isTemplateExpression(e)) {
    const literalParts = [e.head.text, ...e.templateSpans.map((span) => span.literal.text)];
    const appPlatform =
      literalParts.some((part) => part.includes('/apis/')) ||
      e.templateSpans.some((span) => classifyUrl(span.expression, builders, blocks).appPlatform);
    return { appPlatform, text: e.getText() };
  }

  if (ts.isBinaryExpression(e)) {
    const left = classifyUrl(e.left, builders, blocks);
    const right = classifyUrl(e.right, builders, blocks);
    return { appPlatform: left.appPlatform || right.appPlatform, text: e.getText() };
  }

  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) {
    const name = e.expression.text;
    const appPlatform = builders.collectionUrlNames.has(name) || builders.itemUrlNames.has(name);
    return { appPlatform, text: e.getText() };
  }

  if (ts.isIdentifier(e)) {
    const initializer = resolveLocalDeclarationInitializer(e.text, blocks);
    if (initializer) {
      return classifyUrl(initializer, builders, blocks);
    }
    return { appPlatform: false, text: e.getText() };
  }

  return { appPlatform: false, text: e.getText() };
}

// ---------------------------------------------------------------------------
// method classification
//
// Unlike url, method resolution CAN fail with a null result (unresolved):
// once url addresses App Platform, this guard must confidently know every
// possible method value is a mutation before it can stay silent. A
// conditional method (pathfinder-settings-api.ts's `base ? 'PUT' : 'POST'`)
// is a mutation only when EVERY branch resolves to one.
// ---------------------------------------------------------------------------

function resolveMethodValues(expr: ts.Expression, blocks: readonly ts.Node[]): string[] | null {
  let e: ts.Expression = expr;
  while (ts.isParenthesizedExpression(e)) {
    e = e.expression;
  }

  if (ts.isStringLiteralLike(e)) {
    return [e.text];
  }

  if (ts.isConditionalExpression(e)) {
    const whenTrue = resolveMethodValues(e.whenTrue, blocks);
    const whenFalse = resolveMethodValues(e.whenFalse, blocks);
    if (!whenTrue || !whenFalse) {
      return null;
    }
    return [...whenTrue, ...whenFalse];
  }

  if (ts.isIdentifier(e)) {
    const initializer = resolveLocalDeclarationInitializer(e.text, blocks);
    if (!initializer) {
      return null;
    }
    return resolveMethodValues(initializer, blocks);
  }

  return null;
}

function isConfidentMutation(methodValues: string[]): boolean {
  return methodValues.length > 0 && methodValues.every((value) => MUTATION_METHODS.has(value.toUpperCase()));
}

// ---------------------------------------------------------------------------
// .fetch() request-bag resolution
// ---------------------------------------------------------------------------

function findProperty(bag: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const prop of bag.properties) {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === name) {
      return prop.initializer;
    }
    if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === name) {
      return prop.name;
    }
  }
  return undefined;
}

function hasSpread(bag: ts.ObjectLiteralExpression): boolean {
  return bag.properties.some((prop) => ts.isSpreadAssignment(prop));
}

/** Resolves the .fetch() argument to an inline object literal, tracing through at most one same-scope variable. */
function resolveRequestBag(
  argExpr: ts.Expression | undefined,
  blocks: readonly ts.Node[]
): ts.ObjectLiteralExpression | null {
  if (!argExpr) {
    return null;
  }
  let e = argExpr;
  while (ts.isParenthesizedExpression(e)) {
    e = e.expression;
  }
  if (ts.isObjectLiteralExpression(e)) {
    return e;
  }
  if (ts.isIdentifier(e)) {
    const initializer = resolveLocalDeclarationInitializer(e.text, blocks);
    if (initializer) {
      return resolveRequestBag(initializer, blocks);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-call evaluation
// ---------------------------------------------------------------------------

interface Violation {
  file: string;
  line: number;
  method: string;
  urlText: string;
}

interface CallEvaluation {
  appPlatform: boolean;
  violation: Violation | null;
}

function lineOf(node: ts.Node, sourceFile: ts.SourceFile): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function describeArg(argExpr: ts.Expression | undefined): string {
  return argExpr ? argExpr.getText() : '<missing argument>';
}

function evaluateCall(
  call: CandidateCall,
  sourceFile: ts.SourceFile,
  relPath: string,
  builders: BuilderNames
): CallEvaluation {
  const blocks = collectScopeBlocks(call.node, sourceFile);
  const line = lineOf(call.node, sourceFile);
  const args = call.node.arguments;

  if (call.methodName === 'get' || call.methodName === 'post') {
    const urlArg = args[0];
    const { appPlatform, text } = urlArg
      ? classifyUrl(urlArg, builders, blocks)
      : { appPlatform: false, text: '<missing url argument>' };
    if (!appPlatform) {
      return { appPlatform: false, violation: null };
    }
    if (call.methodName === 'post') {
      // Confident mutation — .post() always issues POST regardless of url.
      return { appPlatform: true, violation: null };
    }
    return { appPlatform: true, violation: { file: relPath, line, method: 'GET', urlText: text } };
  }

  // .fetch(...) / .request(...) — both take the same request-bag shape
  const bag = resolveRequestBag(args[0], blocks);
  if (!bag || hasSpread(bag)) {
    return {
      appPlatform: true,
      violation: {
        file: relPath,
        line,
        method: 'unresolved',
        urlText: `could not resolve the request object for getBackendSrv().${call.methodName}(${describeArg(args[0])})`,
      },
    };
  }

  const urlProp = findProperty(bag, 'url');
  if (!urlProp) {
    return {
      appPlatform: true,
      violation: { file: relPath, line, method: 'unresolved', urlText: 'no url property found on the request object' },
    };
  }

  const { appPlatform, text: urlText } = classifyUrl(urlProp, builders, blocks);
  if (!appPlatform) {
    return { appPlatform: false, violation: null };
  }

  const methodProp = findProperty(bag, 'method');
  const methodValues = methodProp ? resolveMethodValues(methodProp, blocks) : ['GET'];
  if (!methodValues) {
    return {
      appPlatform: true,
      violation: { file: relPath, line, method: 'unresolved', urlText },
    };
  }
  if (isConfidentMutation(methodValues)) {
    return { appPlatform: true, violation: null };
  }

  const methodLabel = [...new Set(methodValues.map((value) => value.toUpperCase()))].join('/');
  return { appPlatform: true, violation: { file: relPath, line, method: methodLabel, urlText } };
}

// ---------------------------------------------------------------------------
// Full-repo scan
// ---------------------------------------------------------------------------

interface ScanResult {
  totalCallSites: number;
  appPlatformCallSites: number;
  violations: Violation[];
}

function scanAppPlatformTransport(): ScanResult {
  const files = collectSourceFiles().filter((file) => !isTestFile(file));
  let totalCallSites = 0;
  let appPlatformCallSites = 0;
  const violations: Violation[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const relPath = toPosixPath(path.relative(SRC_DIR, file));
    const sourceFile = ts.createSourceFile(relPath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const fileDir = path.dirname(file);
    const builders = findBuilderNames(sourceFile, fileDir, relPath);

    for (const call of findCandidateCalls(sourceFile)) {
      totalCallSites++;
      const result = evaluateCall(call, sourceFile, relPath, builders);
      if (result.appPlatform) {
        appPlatformCallSites++;
      }
      if (result.violation) {
        violations.push(result.violation);
      }
    }
  }

  if (totalCallSites === 0) {
    throw new Error(
      'Found zero getBackendSrv().fetch/request/get/post(...) call sites under src/. This guard exists to catch a ' +
        'direct App Platform read reaching the browser (incident 5857) — a scan that finds nothing would pass ' +
        'while checking nothing. Something in the walk (collectSourceFiles, or the getBackendSrv() call ' +
        'matcher in this file) is broken; fix that rather than letting this test go green on an empty scan.'
    );
  }

  return { totalCallSites, appPlatformCallSites, violations };
}

/**
 * Line-independent identity for the ratchet/allowlist comparison. A baseline
 * entry must survive unrelated edits to its file — keying on line number
 * would turn any edit above the flagged line into a double failure (a stale
 * entry for the old line, and a "new" violation at the shifted one) even
 * though the flagged call site never changed. Consequence accepted: two
 * structurally identical violations in the same file (same method, same url
 * expression, different lines) collapse to one key, and one allowlist entry
 * grandfathers both — a file either has this violation shape or it does not,
 * and assertRatchet already operates on Sets, so a collapsed duplicate is
 * simply absent rather than double-counted.
 */
function violationKey(violation: Violation): string {
  return `${violation.file} — ${violation.method} ${violation.urlText}`;
}

/** Human-facing form of a violation, with the line number, for reports and error advice — never used as the allowlist key. */
function violationDisplay(violation: Violation): string {
  return `${violation.file}:${violation.line} — ${violation.method} ${violation.urlText}`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('App Platform transport: proxy-first reads', () => {
  const scan = scanAppPlatformTransport();

  it('reports the current App Platform direct-transport footprint', () => {
    console.log(
      `[app-platform-transport-ratchet] getBackendSrv call sites=${scan.totalCallSites} ` +
        `appPlatformAddressed=${scan.appPlatformCallSites} violations=${scan.violations.length}`
    );
    for (const violation of scan.violations) {
      console.log(`  ${violationDisplay(violation)}`);
    }
  });

  it('must proxy every direct, non-mutating App Platform read through the plugin backend', () => {
    const violations = new Set(scan.violations.map(violationKey));
    const allowlist = new Set(ALLOWED_DIRECT_APP_PLATFORM_READS.map((entry) => entry.violation));

    assertRatchet(
      violations,
      allowlist,
      'direct (non-mutating) reads of App Platform from the browser',
      'ALLOWED_DIRECT_APP_PLATFORM_READS',
      ADVICE
    );
  });

  it('every allowlist entry is justified and accountable', () => {
    const errors = validateAllowedArchitectureEntries(ALLOWED_DIRECT_APP_PLATFORM_READS, { allowByDesign: false });
    if (errors.length > 0) {
      throw new Error(
        'ALLOWED_DIRECT_APP_PLATFORM_READS entries must each carry a justification and an accountability ' +
          `reference:\n${errors.map((error) => `  - ${error}`).join('\n')}\n\n` +
          `This exists so a violation can't be silenced by pasting its key in with an empty comment. A ` +
          `direct App Platform read almost never belongs on the allowlist at all (see the advice in the ` +
          `sibling test) — fix it instead of allowlisting it. '${ARCHITECTURE_BY_DESIGN}' is never valid here.`
      );
    }
  });
});

describe('App Platform transport ratchet: detector', () => {
  function evaluateSource(source: string): CallEvaluation {
    const sourceFile = ts.createSourceFile('detector.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const [call] = findCandidateCalls(sourceFile);
    if (!call) {
      throw new Error('detector fixture has no getBackendSrv() call');
    }
    const builders: BuilderNames = {
      collectionUrlNames: new Set(['collectionUrl']),
      itemUrlNames: new Set(['itemUrl']),
    };
    return evaluateCall(call, sourceFile, 'detector.ts', builders);
  }

  function evaluateModuleSource(relPath: string, source: string): CallEvaluation {
    const sourceFile = ts.createSourceFile(relPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const [call] = findCandidateCalls(sourceFile);
    if (!call) {
      throw new Error('detector fixture has no getBackendSrv() call');
    }
    const builders = findBuilderNames(sourceFile, path.join(SRC_DIR, path.dirname(relPath)), relPath);
    return evaluateCall(call, sourceFile, relPath, builders);
  }

  it('flags a direct GET read addressed via the collectionUrl builder', () => {
    const result = evaluateSource(`
      getBackendSrv().fetch({ url: collectionUrl(namespace), method: 'GET', showErrorAlert: false });
    `);
    expect(result.appPlatform).toBe(true);
    expect(result.violation?.method).toBe('GET');
  });

  it('flags a builder url interpolated into a template with a query string', () => {
    const result = evaluateSource(`
      getBackendSrv().fetch({
        url: \`\${collectionUrl(namespace)}?labelSelector=spec.status%3Dpublished\`,
        method: 'GET',
      });
    `);
    expect(result.appPlatform).toBe(true);
    expect(result.violation?.method).toBe('GET');
  });

  it('flags a builder url concatenated with a query string', () => {
    const result = evaluateSource(`
      getBackendSrv().fetch({ url: collectionUrl(namespace) + '?limit=100', method: 'GET' });
    `);
    expect(result.appPlatform).toBe(true);
    expect(result.violation?.method).toBe('GET');
  });

  it('flags a read issued through a receiver hoisted into a variable', () => {
    const result = evaluateSource(`
      function load() {
        const backendSrv = getBackendSrv();
        return backendSrv.fetch({ url: collectionUrl(namespace), method: 'GET' });
      }
    `);
    expect(result.appPlatform).toBe(true);
    expect(result.violation?.method).toBe('GET');
  });

  it('flags a read issued through .request(), which takes the same request bag as .fetch()', () => {
    const result = evaluateSource(`
      getBackendSrv().request({ url: collectionUrl(namespace), method: 'GET' });
    `);
    expect(result.appPlatform).toBe(true);
    expect(result.violation?.method).toBe('GET');
  });

  it('flags a builder call inside the builder module itself, where the builder is declared not imported', () => {
    const result = evaluateModuleSource(
      'utils/pathfinder-settings-api.ts',
      `
      export function collectionUrl(namespace) {
        return \`/apis/\${APP_PLATFORM_API_VERSION}/namespaces/\${namespace}/\${RESOURCE}\`;
      }
      export function itemUrl(namespace, name) {
        return \`\${collectionUrl(namespace)}/\${name}\`;
      }
      export async function read() {
        return getBackendSrv().fetch({ url: itemUrl(config.namespace), method: 'GET' });
      }
    `
    );
    expect(result.appPlatform).toBe(true);
    expect(result.violation?.method).toBe('GET');
  });

  it('does not treat a locally declared collectionUrl outside a builder module as an App Platform builder', () => {
    const result = evaluateModuleSource(
      'lib/unrelated-client.ts',
      `
      function collectionUrl(id) {
        return \`/api/plugins/\${id}/resources/collection\`;
      }
      getBackendSrv().fetch({ url: collectionUrl(pluginId), method: 'GET' });
    `
    );
    expect(result.appPlatform).toBe(false);
    expect(result.violation).toBeNull();
  });

  it('does not flag a template url whose interpolations never reach App Platform', () => {
    const result = evaluateSource(`
      getBackendSrv().get(\`/api/datasources/uid/\${uid}/health\`);
    `);
    expect(result.appPlatform).toBe(false);
    expect(result.violation).toBeNull();
  });

  it('does not flag a mutation whose method is a ternary where every branch is a mutation', () => {
    const result = evaluateSource(`
      function save() {
        const request = {
          url: base ? itemUrl(namespace, name) : collectionUrl(namespace),
          method: base ? 'PUT' : 'POST',
        };
        getBackendSrv().fetch(request);
      }
    `);
    expect(result.appPlatform).toBe(true);
    expect(result.violation).toBeNull();
  });

  it('flags a ternary method as a violation when only one branch is a mutation', () => {
    const result = evaluateSource(`
      function save() {
        const request = {
          url: collectionUrl(namespace),
          method: base ? 'PUT' : 'GET',
        };
        getBackendSrv().fetch(request);
      }
    `);
    expect(result.violation).not.toBeNull();
  });

  it('does not flag a url built by an unrelated function, even when unresolved as an identifier', () => {
    const result = evaluateSource(`
      async function readJson(url) {
        return getBackendSrv().fetch({ url, method: 'GET', showErrorAlert: false });
      }
    `);
    expect(result.appPlatform).toBe(false);
    expect(result.violation).toBeNull();
  });

  it('reports unresolved rather than passing silently when the request object cannot be traced', () => {
    const result = evaluateSource(`
      getBackendSrv().fetch(buildRequestOptions());
    `);
    expect(result.violation?.method).toBe('unresolved');
  });

  it('does not anchor on "/apis/" outside a getBackendSrv() call', () => {
    const sourceFile = ts.createSourceFile(
      'detector.tsx',
      `new OFREPWebProvider({ baseUrl: \`/apis/features.grafana.app/v0alpha1/namespaces/\${namespace}\` });`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    expect(findCandidateCalls(sourceFile)).toEqual([]);
  });
});
