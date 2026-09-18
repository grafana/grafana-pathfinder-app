import { readFileSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';

import { STEP_TYPE_KIND_KEYS, type StepTypeKind } from './step-type-registry';
import { getTrackedStepRootAttributes } from './tracked-step-root-attributes';

interface RootContract {
  sourceFile: string;
  stableTestIdExpression: string;
  stepIdExpression: string;
  legacyStepIdExpression?: string;
  rootCount: number;
}

const ROOT_CONTRACTS: Record<StepTypeKind, RootContract> = {
  plain: {
    sourceFile: 'interactive-step.tsx',
    stableTestIdExpression: 'testIds.interactive.step(renderedStepId)',
    stepIdExpression: 'stepId || renderedStepId',
    legacyStepIdExpression: 'stepId || renderedStepId',
    rootCount: 1,
  },
  multistep: {
    sourceFile: 'interactive-multi-step.tsx',
    stableTestIdExpression: 'testIds.interactive.step(renderedStepId)',
    stepIdExpression: 'stepId || renderedStepId',
    legacyStepIdExpression: 'stepId || renderedStepId',
    rootCount: 1,
  },
  guided: {
    sourceFile: 'interactive-guided.tsx',
    stableTestIdExpression: 'testIds.interactive.step(renderedStepId)',
    stepIdExpression: 'stepId || renderedStepId',
    legacyStepIdExpression: 'stepId || renderedStepId',
    rootCount: 1,
  },
  quiz: {
    sourceFile: 'interactive-quiz.tsx',
    stableTestIdExpression: 'testIds.interactive.quiz(stepId)',
    stepIdExpression: 'stepId',
    rootCount: 1,
  },
  terminal: {
    sourceFile: 'terminal-step.tsx',
    stableTestIdExpression: 'testIds.interactive.terminalStep(renderedStepId)',
    stepIdExpression: 'renderedStepId',
    rootCount: 1,
  },
  'terminal-connect': {
    sourceFile: 'terminal-connect-step.tsx',
    stableTestIdExpression: 'testIds.interactive.terminalConnectStep(renderedStepId)',
    stepIdExpression: 'renderedStepId',
    rootCount: 1,
  },
  codeblock: {
    sourceFile: 'code-block-step.tsx',
    stableTestIdExpression: 'testIds.codeBlock.step(renderedStepId)',
    stepIdExpression: 'renderedStepId',
    rootCount: 1,
  },
  challenge: {
    sourceFile: 'challenge-block.tsx',
    stableTestIdExpression: '`challenge-block-${stepId}`',
    stepIdExpression: 'stepId',
    rootCount: 2,
  },
  'datasource-check': {
    sourceFile: 'datasource-check-step.tsx',
    stableTestIdExpression: 'testIds.dataCheck.step(renderedStepId)',
    stepIdExpression: 'renderedStepId',
    rootCount: 1,
  },
};
type IntrinsicJsxRoot = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

function getAttribute(root: IntrinsicJsxRoot, sourceFile: ts.SourceFile, name: string): ts.JsxAttribute | undefined {
  return root.attributes.properties.find(
    (property): property is ts.JsxAttribute => ts.isJsxAttribute(property) && property.name.getText(sourceFile) === name
  );
}

function getAttributeExpression(attribute: ts.JsxAttribute | undefined, sourceFile: ts.SourceFile): string | undefined {
  if (!attribute?.initializer || !ts.isJsxExpression(attribute.initializer)) {
    return undefined;
  }
  return attribute.initializer.expression?.getText(sourceFile);
}

function findStableRoots(sourceFile: ts.SourceFile, stableTestIdExpression: string): IntrinsicJsxRoot[] {
  const roots: IntrinsicJsxRoot[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = node.tagName.getText(sourceFile);
      const testId = getAttributeExpression(getAttribute(node, sourceFile, 'data-testid'), sourceFile);
      const firstCharacter = tagName.charAt(0);
      if (firstCharacter >= 'a' && firstCharacter <= 'z' && testId === stableTestIdExpression) {
        roots.push(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return roots;
}

function findRootHelperCalls(root: IntrinsicJsxRoot): ts.CallExpression[] {
  return root.attributes.properties
    .filter(ts.isJsxSpreadAttribute)
    .map((attribute) => attribute.expression)
    .filter(
      (expression): expression is ts.CallExpression =>
        ts.isCallExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        expression.expression.text === 'getTrackedStepRootAttributes'
    );
}

describe('tracked step root contract', () => {
  it('has one contract case for every registered kind', () => {
    expect(Object.keys(ROOT_CONTRACTS)).toEqual(STEP_TYPE_KIND_KEYS);
  });

  it.each(STEP_TYPE_KIND_KEYS)('%s owns its root attributes through the typed helper', (kind) => {
    const contract = ROOT_CONTRACTS[kind];
    const source = readFileSync(join(__dirname, contract.sourceFile), 'utf8');
    const sourceFile = ts.createSourceFile(
      contract.sourceFile,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    const stableRoots = findStableRoots(sourceFile, contract.stableTestIdExpression);

    expect(stableRoots).toHaveLength(contract.rootCount);
    for (const root of stableRoots) {
      const helperCalls = findRootHelperCalls(root);
      expect(helperCalls).toHaveLength(1);
      expect(helperCalls[0]?.arguments).toHaveLength(2);
      expect(helperCalls[0]?.arguments[0]?.getText(sourceFile)).toBe(`'${kind}'`);
      expect(helperCalls[0]?.arguments[1]?.getText(sourceFile)).toBe(contract.stepIdExpression);
      expect(getAttribute(root, sourceFile, 'data-test-step-kind')).toBeUndefined();
      expect(getAttribute(root, sourceFile, 'data-test-step-id')).toBeUndefined();

      const legacyStepId = getAttribute(root, sourceFile, 'data-step-id');
      if (contract.legacyStepIdExpression) {
        expect(getAttributeExpression(legacyStepId, sourceFile)).toBe(contract.legacyStepIdExpression);
      } else {
        expect(legacyStepId).toBeUndefined();
      }
    }
  });

  it.each(STEP_TYPE_KIND_KEYS)('%s has the registered kind and stable step ID', (kind) => {
    expect(getTrackedStepRootAttributes(kind, 'contract-step')).toEqual({
      'data-test-step-kind': kind,
      'data-test-step-id': 'contract-step',
    });
  });
});
