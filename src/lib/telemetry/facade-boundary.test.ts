import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const RESTRICTED_PRIMITIVES = new Set(['pushFaroEvent', 'pushFaroMeasurement']);
const SRC_ROOT = path.join(__dirname, '../..');
const ALLOWED_DIR = path.join(SRC_ROOT, 'lib/telemetry');
const FARO_ADAPTER = path.join(ALLOWED_DIR, 'faro-adapter');
const TELEMETRY_BARREL = path.join(ALLOWED_DIR, 'index.ts');
const COMPATIBILITY_BARREL = path.join(SRC_ROOT, 'lib/faro.ts');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return walk(full);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

function isWithinDirectory(file: string, directory: string): boolean {
  const relative = path.relative(directory, file);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function findRestrictedPrimitiveReferences(source: string, fileName = 'input.ts'): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const references = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && RESTRICTED_PRIMITIVES.has(node.text)) {
      references.add(node.text);
    }
    if (
      ts.isStringLiteralLike(node) &&
      ts.isElementAccessExpression(node.parent) &&
      node.parent.argumentExpression === node &&
      RESTRICTED_PRIMITIVES.has(node.text)
    ) {
      references.add(node.text);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return [...references].sort();
}

function importsFaroAdapterDirectly(source: string, fileName: string): boolean {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let importsAdapter = false;

  const matchesAdapter = (specifier: string): boolean => {
    if (!specifier.startsWith('.')) {
      return false;
    }
    return path.resolve(path.dirname(fileName), specifier).replace(/\.(ts|tsx)$/, '') === FARO_ADAPTER;
  };

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      matchesAdapter(node.moduleSpecifier.text)
    ) {
      importsAdapter = true;
    }
    if (ts.isCallExpression(node)) {
      const [specifier] = node.arguments;
      if (
        specifier &&
        ts.isStringLiteralLike(specifier) &&
        ((ts.isIdentifier(node.expression) && node.expression.text === 'require') ||
          node.expression.kind === ts.SyntaxKind.ImportKeyword) &&
        matchesAdapter(specifier.text)
      ) {
        importsAdapter = true;
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return importsAdapter;
}

describe('telemetry facade boundary', () => {
  it.each([
    ["import { pushFaroEvent } from './lib/faro';", 'named import'],
    ["import * as faro from './lib/faro'; faro.pushFaroEvent('custom');", 'namespace import'],
    ["export { pushFaroMeasurement } from './lib/faro';", 're-export'],
    ["const { pushFaroEvent } = require('./lib/faro');", 'CommonJS import'],
    ["void import('./lib/faro').then((faro) => faro.pushFaroMeasurement('custom', {}));", 'dynamic import'],
    ["const faro = require('./lib/faro'); faro['pushFaroEvent']('custom');", 'computed property access'],
  ])('detects a restricted primitive used through a %s', (source) => {
    expect(findRestrictedPrimitiveReferences(source)).not.toEqual([]);
  });

  it('ignores allowed helpers and primitive names in prose', () => {
    const source = `
      import { pushFaroError, setFaroViewName } from './lib/faro';
      const explanation = 'pushFaroEvent is reserved';
      // pushFaroMeasurement is reserved.
    `;
    expect(findRestrictedPrimitiveReferences(source)).toEqual([]);
  });

  it('does not treat a sibling path as part of the telemetry directory', () => {
    expect(isWithinDirectory(path.join(SRC_ROOT, 'lib/telemetry-bypass.ts'), ALLOWED_DIR)).toBe(false);
  });

  it.each([
    "import { pushFaroEvent as emit } from '../lib/telemetry/faro-adapter';",
    "import * as adapter from '../lib/telemetry/faro-adapter';",
    "export * from '../lib/telemetry/faro-adapter';",
    "const adapter = require('../lib/telemetry/faro-adapter');",
    "void import('../lib/telemetry/faro-adapter');",
  ])('detects a direct adapter import: %s', (source) => {
    expect(importsFaroAdapterDirectly(source, path.join(SRC_ROOT, 'components/example.ts'))).toBe(true);
  });

  it('keeps raw event and measurement primitives inside lib/telemetry', () => {
    const violations = walk(SRC_ROOT)
      .filter((file) => !/\.test\.(ts|tsx)$/.test(file))
      .filter((file) => !isWithinDirectory(file, ALLOWED_DIR) || file === TELEMETRY_BARREL)
      .flatMap((file) => {
        const source = fs.readFileSync(file, 'utf8');
        const references = findRestrictedPrimitiveReferences(source, file).map(
          (primitive) => `${path.relative(SRC_ROOT, file)}: ${primitive}`
        );
        const directAdapterImport =
          file !== COMPATIBILITY_BARREL && importsFaroAdapterDirectly(source, file)
            ? [`${path.relative(SRC_ROOT, file)}: direct faro-adapter import`]
            : [];
        return [...references, ...directAdapterImport];
      });

    expect(violations).toEqual([]);
  });
});
