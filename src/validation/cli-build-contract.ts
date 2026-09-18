import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

import { extractImportRecords, toPosixPath } from './import-graph';

export interface TypeScriptCompileClosure {
  roots: string[];
  files: string[];
  chains: Map<string, string[]>;
}

function isWithinDirectory(filePath: string, directory: string): boolean {
  const relative = path.relative(directory, filePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function formatTsDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
  return ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getNewLine: () => ts.sys.newLine,
  });
}

export function buildTypeScriptCompileClosure(tsconfigPath: string): TypeScriptCompileClosure {
  const absoluteTsconfigPath = path.resolve(tsconfigPath);
  const repoRoot = path.dirname(absoluteTsconfigPath);
  const srcRoot = path.join(repoRoot, 'src');
  const config = ts.readConfigFile(absoluteTsconfigPath, ts.sys.readFile);
  if (config.error) {
    throw new Error(formatTsDiagnostics([config.error]));
  }
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, repoRoot, undefined, absoluteTsconfigPath);
  const errorsOtherThanNoInputs = parsed.errors.filter((diagnostic) => diagnostic.code !== 18003);
  if (errorsOtherThanNoInputs.length > 0) {
    throw new Error(formatTsDiagnostics(errorsOtherThanNoInputs));
  }

  const program = ts.createProgram({ rootNames: parsed.fileNames, options: { ...parsed.options, noEmit: true } });
  const sourceFiles = program
    .getSourceFiles()
    .map((sourceFile) => path.resolve(sourceFile.fileName))
    .filter((fileName) => isWithinDirectory(fileName, srcRoot));
  const relativePath = (fileName: string): string => toPosixPath(path.relative(repoRoot, fileName));
  const files = [...new Set(sourceFiles.map(relativePath))].sort();
  const fileSet = new Set(files);
  const roots = [
    ...new Set(
      parsed.fileNames
        .map((fileName) => path.resolve(fileName))
        .filter((fileName) => isWithinDirectory(fileName, srcRoot))
    ),
  ]
    .map(relativePath)
    .filter((fileName) => fileSet.has(fileName))
    .sort();
  const adjacency = new Map<string, string[]>();
  const resolutionCache = ts.createModuleResolutionCache(repoRoot, (fileName) => fileName, parsed.options);

  for (const fileName of sourceFiles) {
    const source = fs.readFileSync(fileName, 'utf-8');
    const targets = extractImportRecords(source)
      .map(
        (record) =>
          ts.resolveModuleName(record.specifier, fileName, parsed.options, ts.sys, resolutionCache).resolvedModule
            ?.resolvedFileName
      )
      .filter((target): target is string => Boolean(target))
      .map((target) => relativePath(path.resolve(target)))
      .filter((target) => fileSet.has(target));
    adjacency.set(relativePath(fileName), [...new Set(targets)].sort());
  }

  const chains = new Map<string, string[]>();
  const queue = [...roots];
  for (const root of roots) {
    chains.set(root, [root]);
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const target of adjacency.get(current) ?? []) {
      if (!chains.has(target)) {
        chains.set(target, [...(chains.get(current) ?? [current]), target]);
        queue.push(target);
      }
    }
  }
  for (const fileName of files) {
    if (!chains.has(fileName)) {
      chains.set(fileName, [fileName]);
    }
  }
  return { roots, files, chains };
}

const compileClosureCache = new Map<string, TypeScriptCompileClosure>();

export function getTypeScriptCompileClosure(tsconfigPath: string): TypeScriptCompileClosure {
  const absoluteTsconfigPath = path.resolve(tsconfigPath);
  const cached = compileClosureCache.get(absoluteTsconfigPath);
  if (cached) {
    return cached;
  }
  const closure = buildTypeScriptCompileClosure(absoluteTsconfigPath);
  compileClosureCache.set(absoluteTsconfigPath, closure);
  return closure;
}

function dockerfileInstructions(content: string): string[] {
  const instructions: string[] = [];
  let pending = '';
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || (!pending && line.startsWith('#'))) {
      continue;
    }
    pending += `${pending ? ' ' : ''}${line.replace(/\\$/, '').trim()}`;
    if (!line.endsWith('\\')) {
      instructions.push(pending);
      pending = '';
    }
  }
  if (pending) {
    instructions.push(pending);
  }
  return instructions;
}

function normalizeContractPath(filePath: string): string {
  const normalized = toPosixPath(filePath).replace(/^\.\//, '').replace(/\/$/, '');
  return normalized === '.' ? '' : normalized;
}

interface DockerCopy {
  sources: string[];
  destination: string;
}

function parseCopyOperands(value: string): DockerCopy & { fromStage: boolean } {
  if (value.trimStart().startsWith('[')) {
    const paths = JSON.parse(value) as string[];
    return {
      sources: paths.slice(0, -1).map(normalizeContractPath),
      destination: normalizeContractPath(paths[paths.length - 1] ?? ''),
      fromStage: false,
    };
  }
  const tokens = value.match(/"(?:\\.|[^"\\])*"|'[^']*'|\S+/g) ?? [];
  const paths: string[] = [];
  let fromStage = false;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token === '--from') {
      fromStage = true;
      index++;
    } else if (token.startsWith('--from=')) {
      fromStage = true;
    } else if (!token.startsWith('--')) {
      paths.push(token.replace(/^(['"])(.*)\1$/, '$2'));
    }
  }
  return {
    sources: paths.slice(0, -1).map(normalizeContractPath),
    destination: normalizeContractPath(paths[paths.length - 1] ?? ''),
    fromStage,
  };
}

function parseDockerfileLocalCopies(content: string, stage: string): DockerCopy[] {
  let currentStage = '';
  const copies: DockerCopy[] = [];
  for (const instruction of dockerfileInstructions(content)) {
    const from = /^FROM\s+\S+(?:\s+AS\s+(\S+))?/i.exec(instruction);
    if (from) {
      currentStage = from[1] ?? '';
      continue;
    }
    const copy = /^COPY\s+(.+)$/i.exec(instruction);
    if (!copy || currentStage.toLowerCase() !== stage.toLowerCase()) {
      continue;
    }
    const operands = parseCopyOperands(copy[1]!);
    if (!operands.fromStage) {
      copies.push({ sources: operands.sources, destination: operands.destination });
    }
  }
  return copies;
}

export function parseDockerfileLocalCopySources(content: string, stage: string): string[] {
  return [...new Set(parseDockerfileLocalCopies(content, stage).flatMap((copy) => copy.sources))];
}

function globRegex(pattern: string, matchDescendants: boolean): RegExp {
  const normalized = normalizeContractPath(pattern).replace(/^\//, '');
  let source = '';
  for (let index = 0; index < normalized.length; index++) {
    const char = normalized[index]!;
    if (char === '*') {
      if (normalized[index + 1] === '*') {
        index++;
        if (normalized[index + 1] === '/') {
          index++;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.-]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}${matchDescendants ? '(?:/.*)?' : ''}$`);
}

function pathCoveredBySource(fileName: string, source: string): boolean {
  const normalizedSource = normalizeContractPath(source);
  if (!normalizedSource) {
    return true;
  }
  if (/[*?[]/.test(normalizedSource)) {
    return globRegex(normalizedSource, true).test(fileName);
  }
  return fileName === normalizedSource || fileName.startsWith(`${normalizedSource}/`);
}

function pathCoveredByCopy(fileName: string, copy: DockerCopy): boolean {
  return copy.sources.some((source) => {
    if (!pathCoveredBySource(fileName, source)) {
      return false;
    }
    const relative = source ? fileName.slice(source.length).replace(/^\//, '') : fileName;
    const destination = [copy.destination, relative].filter(Boolean).join('/');
    return destination === fileName;
  });
}

export function isPathExcludedByDockerignore(fileName: string, content: string): boolean {
  let excluded = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line === '.') {
      continue;
    }
    const negated = line.startsWith('!');
    const pattern = negated ? line.slice(1) : line;
    if (globRegex(pattern, true).test(fileName)) {
      excluded = !negated;
    }
  }
  return excluded;
}

export interface WorkflowPathFilters {
  push?: string[];
  pull_request?: string[];
}

export function parseWorkflowPathFilters(content: string): WorkflowPathFilters {
  const result: WorkflowPathFilters = {};
  let event: keyof WorkflowPathFilters | undefined;
  let inPaths = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    const indent = rawLine.length - rawLine.trimStart().length;
    if (indent === 2 && /^(push|pull_request):$/.test(trimmed)) {
      event = trimmed.slice(0, -1) as keyof WorkflowPathFilters;
      inPaths = false;
      continue;
    }
    if (event && indent <= 2 && trimmed) {
      event = undefined;
      inPaths = false;
    }
    if (event && indent === 4 && trimmed === 'paths:') {
      result[event] = [];
      inPaths = true;
      continue;
    }
    if (event && inPaths && indent >= 6 && trimmed.startsWith('- ')) {
      result[event]!.push(
        trimmed
          .slice(2)
          .trim()
          .replace(/^(['"])(.*)\1$/, '$2')
      );
    } else if (event && inPaths && indent <= 4 && trimmed) {
      inPaths = false;
    }
  }
  return result;
}

function workflowPathsCover(fileName: string, patterns: readonly string[]): boolean {
  let covered = false;
  for (const rawPattern of patterns) {
    const negated = rawPattern.startsWith('!');
    const pattern = negated ? rawPattern.slice(1) : rawPattern;
    if (globRegex(pattern, false).test(fileName)) {
      covered = !negated;
    }
  }
  return covered;
}

export interface CliBuildContractInputs {
  dockerfile: string;
  dockerignore: string;
  workflows: Record<string, string>;
}

export function validateCliBuildContract(closure: TypeScriptCompileClosure, inputs: CliBuildContractInputs): string[] {
  if (closure.files.length === 0) {
    return ['tsconfig.cli.json compile closure is empty.'];
  }
  const errors: string[] = [];
  const copies = parseDockerfileLocalCopies(inputs.dockerfile, 'builder');
  const describeFile = (fileName: string): string => {
    const chain = closure.chains.get(fileName) ?? [fileName];
    return `${fileName} (import chain: ${chain.join(' -> ')})`;
  };

  for (const fileName of closure.files) {
    if (!copies.some((copy) => pathCoveredByCopy(fileName, copy))) {
      errors.push(`Dockerfile.cli builder COPY does not cover ${describeFile(fileName)}`);
    }
    if (isPathExcludedByDockerignore(fileName, inputs.dockerignore)) {
      errors.push(`.dockerignore excludes required file ${describeFile(fileName)}`);
    }
  }

  for (const [workflowName, content] of Object.entries(inputs.workflows)) {
    const filters = parseWorkflowPathFilters(content);
    for (const event of ['push', 'pull_request'] as const) {
      for (const fileName of closure.files) {
        if (!workflowPathsCover(fileName, filters[event] ?? [])) {
          errors.push(`${workflowName} ${event} paths do not cover required file ${describeFile(fileName)}`);
        }
      }
    }
  }
  return errors;
}
