import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

// A rejected top-level await fails module evaluation and Grafana reports
// "Could not load plugin", killing Pathfinder for the whole session — the
// production incident fixed in PR #1335. Jest cannot evaluate module.tsx
// (top-level await under a CJS transform), so this source-level check is the
// regression guard: every top-level await must sit inside the try block of a
// try/catch. Awaits inside catch/finally still reject module evaluation, so
// they count as unguarded.

function isFunctionBoundary(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function isInsideTryBlock(node: ts.Node): boolean {
  let child: ts.Node = node;
  let ancestor: ts.Node | undefined = node.parent;
  while (ancestor && !ts.isSourceFile(ancestor)) {
    if (ts.isTryStatement(ancestor) && ancestor.tryBlock === child) {
      return true;
    }
    child = ancestor;
    ancestor = ancestor.parent;
  }
  return false;
}

describe('module.tsx bootstrap', () => {
  it('keeps every top-level await inside a try block', () => {
    const filePath = path.resolve(__dirname, '..', 'module.tsx');
    const sourceFile = ts.createSourceFile(
      'module.tsx',
      fs.readFileSync(filePath, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );

    const unguarded: string[] = [];

    const visit = (node: ts.Node): void => {
      if (isFunctionBoundary(node)) {
        return;
      }
      const isTopLevelAwait =
        ts.isAwaitExpression(node) || (ts.isForOfStatement(node) && node.awaitModifier !== undefined);
      if (isTopLevelAwait && !isInsideTryBlock(node)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        unguarded.push(`module.tsx:${line + 1} — ${node.getText().split('\n')[0]}`);
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);

    expect(unguarded).toEqual([]);
  });
});
