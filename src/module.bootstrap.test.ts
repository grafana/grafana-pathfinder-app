import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

// module.tsx uses top-level `await`, which @swc/jest transpiles to CommonJS and
// cannot execute, so the bootstrap cannot be imported and run here. It is still
// the only place the durable completion-write hook is armed: if that call is
// dropped, moved off plugin.init, or sunk below one of init's early returns,
// completion recording silently stops for every surface and no behavioural test
// anywhere fails. This asserts the wiring structurally instead.
//
// Arming is deferred behind a dynamic import so the write stack stays out of
// module.js, so the pinned shape is "one statement of plugin.init that imports
// the hook module and calls the arm function", not a bare top-level call. A
// static import would defeat the split, so it is pinned closed as well.
const ARM_FN = 'armCompletionWriteHook';
const ARM_MODULE = './completion-records/completion-write-hook';
const STATIC_IMPORT_RE = /^import\s[^;]*from\s+['"]\.\/completion-records(\/[^'"]*)?['"]/m;
const MODULE_ENTRY = path.join(__dirname, 'module.tsx');

const sourceFile = ts.createSourceFile(
  MODULE_ENTRY,
  fs.readFileSync(MODULE_ENTRY, 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);

function findPluginInitBody(): ts.Statement[] {
  let body: ts.Statement[] | undefined;

  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      ts.isIdentifier(node.left.expression) &&
      node.left.expression.text === 'plugin' &&
      node.left.name.text === 'init' &&
      (ts.isFunctionExpression(node.right) || ts.isArrowFunction(node.right)) &&
      node.right.body &&
      ts.isBlock(node.right.body)
    ) {
      body = [...node.right.body.statements];
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  if (!body) {
    throw new Error('could not locate the `plugin.init = function (...)` assignment in module.tsx');
  }
  return body;
}

function importsHookModule(node: ts.Node): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (
      ts.isCallExpression(child) &&
      child.expression.kind === ts.SyntaxKind.ImportKeyword &&
      child.arguments.length > 0 &&
      ts.isStringLiteralLike(child.arguments[0]!) &&
      (child.arguments[0] as ts.StringLiteralLike).text === ARM_MODULE
    ) {
      found = true;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function callsArmFn(node: ts.Node): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === ARM_FN) {
      found = true;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

// The arming statement: whatever its syntax, it must both load the hook module
// and call the arm function. Nesting is allowed (the call lives in the import's
// `.then`); position within init's statement list is not — see the tests below.
function isArmCall(statement: ts.Statement): boolean {
  return importsHookModule(statement) && callsArmFn(statement);
}

function containsReturn(node: ts.Node): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    // Don't descend into nested functions — their `return` isn't init's.
    if (ts.isFunctionDeclaration(child) || ts.isFunctionExpression(child) || ts.isArrowFunction(child)) {
      return;
    }
    if (ts.isReturnStatement(child)) {
      found = true;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

describe('module bootstrap arms the durable completion-write hook', () => {
  it(`loads ${ARM_MODULE} dynamically, keeping the write stack out of module.js`, () => {
    const source = fs.readFileSync(MODULE_ENTRY, 'utf8');
    expect(source).not.toMatch(STATIC_IMPORT_RE);
    expect(importsHookModule(sourceFile)).toBe(true);
  });

  it('arms it from a top-level statement of plugin.init, so every surface arms it', () => {
    const armCalls = findPluginInitBody().filter(isArmCall);
    expect(armCalls).toHaveLength(1);
  });

  it('calls it before any of init’s early returns', () => {
    const body = findPluginInitBody();
    const armIndex = body.findIndex(isArmCall);
    const firstReturnIndex = body.findIndex(containsReturn);

    expect(armIndex).toBeGreaterThanOrEqual(0);
    if (firstReturnIndex >= 0) {
      expect(armIndex).toBeLessThan(firstReturnIndex);
    }
  });
});
