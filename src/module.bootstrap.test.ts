import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

// module.tsx uses top-level `await`, which @swc/jest transpiles to CommonJS and
// cannot execute, so the bootstrap cannot be imported and run here. It is still
// the only place the durable completion-write hook is armed: if that call is
// dropped, moved off plugin.init, or sunk below one of init's early returns,
// completion recording silently stops for every surface and no behavioural test
// anywhere fails. This asserts the wiring structurally instead.
const ARM_FN = 'armCompletionWriteHook';
const ARM_MODULE = './completion-records';
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

function isArmCall(statement: ts.Statement): boolean {
  return (
    ts.isExpressionStatement(statement) &&
    ts.isCallExpression(statement.expression) &&
    ts.isIdentifier(statement.expression.expression) &&
    statement.expression.expression.text === ARM_FN
  );
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

function importsArmFn(): boolean {
  let imported = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      node.moduleSpecifier.text === ARM_MODULE &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings) &&
      node.importClause.namedBindings.elements.some((element) => element.name.text === ARM_FN)
    ) {
      imported = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return imported;
}

describe('module bootstrap arms the durable completion-write hook', () => {
  it(`imports ${ARM_FN} from ${ARM_MODULE}`, () => {
    expect(importsArmFn()).toBe(true);
  });

  it('calls it as a top-level statement of plugin.init, so every surface arms it', () => {
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
