/**
 * Skill / rule reference graph tests.
 *
 * Walks every agent-facing prose file in the repo — `.cursor/skills/*\/SKILL.md`,
 * `.cursor/rules/*.mdc`, `AGENTS.md`, `CLAUDE.md` — and asserts that the things
 * those files point at still exist:
 *
 *   1. Repo path refs (in backticks) resolve to a real file on disk.
 *   2. Adjacent heading refs (`` `<file>.md` "<heading>" `` or `` `<file>.md` § <heading> ``)
 *      resolve to a real heading in the target file.
 *   3. Code IDs (F1–F6, R1–R21, QC1–QC8, G1–G7) are defined in their
 *      canonical source-of-truth file.
 *
 * Why this exists: F-2 (per docs/design/AGENT_HARDENING.md) was a real bug
 * where `.cursor/skills/prevent-doc-drift/SKILL.md` instructed the skill to
 * edit a heading in `AGENTS.md` that had already been renamed. The skill was
 * silently operating against a target that no longer existed. Phase A fixed
 * today's stale references by hand; this test prevents tomorrow's.
 *
 * Fenced code blocks (triple-backtick) are stripped before extraction so that
 * illustrative paths inside examples ("`A  src/recommendation-cache/cache.ts`",
 * `cat src/App.tsx`, etc.) don't trigger false positives. A small allowlist
 * covers illustrative paths that appear in narrative prose intentionally
 * (e.g., placeholder `foo-step.tsx`); each entry carries a reason.
 */

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

interface ProseFile {
  label: string;
  absPath: string;
  raw: string;
  stripped: string;
}

function stripFencedCodeBlocks(content: string): string {
  // Replace fenced blocks with blank lines to preserve line numbers for any
  // future error messages that want to cite a line.
  return content.replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, ''));
}

function makeProseFile(label: string, absPath: string): ProseFile {
  const raw = fs.readFileSync(absPath, 'utf-8');
  return { label, absPath, raw, stripped: stripFencedCodeBlocks(raw) };
}

function loadProseFiles(): ProseFile[] {
  const out: ProseFile[] = [];

  const skillsDir = path.join(REPO_ROOT, '.cursor', 'skills');
  for (const name of fs.readdirSync(skillsDir).sort()) {
    const f = path.join(skillsDir, name, 'SKILL.md');
    if (fs.existsSync(f)) {
      out.push(makeProseFile(`.cursor/skills/${name}/SKILL.md`, f));
    }
  }

  const rulesDir = path.join(REPO_ROOT, '.cursor', 'rules');
  for (const name of fs.readdirSync(rulesDir).sort()) {
    if (name.endsWith('.mdc')) {
      out.push(makeProseFile(`.cursor/rules/${name}`, path.join(rulesDir, name)));
    }
  }

  for (const root of ['AGENTS.md', 'CLAUDE.md']) {
    const f = path.join(REPO_ROOT, root);
    if (fs.existsSync(f)) {
      out.push(makeProseFile(root, f));
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// 1. Path references
// ---------------------------------------------------------------------------
//
// Match backtick-wrapped repo paths. Only enforce paths under the known
// agent-relevant roots so we don't accidentally pick up things like
// `node_modules/...` or imports from external packages.

const PATH_REF_RE =
  /`((?:\.cursor\/(?:skills|rules)|docs\/(?:design|developer)|src|pkg|scripts|\.github)\/[A-Za-z0-9_./@-]+|AGENTS\.md|CLAUDE\.md|CHANGELOG\.md|README\.md|package\.json|tsconfig\.json|eslint\.config\.mjs|playwright\.config\.ts|Magefile\.go)(?::\d+)?(?:#[A-Za-z0-9_-]+)?`/g;

/**
 * Paths that legitimately appear in narrative prose but do not correspond to
 * real files — illustrative examples that aren't worth restructuring around
 * a code fence. Each entry must include a `reason`.
 */
const ILLUSTRATIVE_PATH_ALLOWLIST: Array<{ ref: string; reason: string }> = [
  { ref: 'docs/developer/...', reason: 'Literal "..." placeholder in maintain-docs cross-reference template.' },
  { ref: 'src/faro.ts', reason: 'Hypothetical singleton extraction target in plugin-bundle-size guidance.' },
  { ref: 'src/faro/index.ts', reason: 'Hypothetical alternative location in plugin-bundle-size guidance.' },
  {
    ref: 'src/components/interactive-tutorial/foo-step.tsx',
    reason: 'Placeholder "foo-step" component path in tracked-step-types template.',
  },
];

const ILLUSTRATIVE_PATH_REFS = new Set(ILLUSTRATIVE_PATH_ALLOWLIST.map((e) => e.ref));

function isExtractedPathRefSkippable(ref: string): boolean {
  // Globs, angle-bracket placeholders, or dir-only refs (trailing slash) are
  // not assertions about concrete files. Skip them.
  return ref.includes('*') || ref.includes('<') || ref.endsWith('/');
}

describe('Skill/rule reference graph — path refs', () => {
  const files = loadProseFiles();

  it.each(files.map((f) => [f.label, f] as const))('%s: every backticked repo path exists', (_label, file) => {
    const broken: Array<{ ref: string }> = [];
    const seen = new Set<string>();

    for (const m of file.stripped.matchAll(PATH_REF_RE)) {
      const ref = m[1];
      if (ref === undefined) {
        continue;
      }
      if (isExtractedPathRefSkippable(ref)) {
        continue;
      }
      if (seen.has(ref)) {
        continue;
      }
      seen.add(ref);
      if (ILLUSTRATIVE_PATH_REFS.has(ref)) {
        continue;
      }
      const abs = path.join(REPO_ROOT, ref);
      if (!fs.existsSync(abs)) {
        broken.push({ ref });
      }
    }

    if (broken.length > 0) {
      const lines = broken.map(({ ref }) => `  - \`${ref}\` (not found at ${path.join(REPO_ROOT, ref)})`);
      throw new Error(
        `${file.label} references repo paths that no longer exist:\n${lines.join('\n')}\n\n` +
          `Either fix the reference, rename the path, or — if the path is a deliberate ` +
          `illustrative placeholder in prose — add it to ILLUSTRATIVE_PATH_ALLOWLIST in ` +
          `src/validation/skill-references.test.ts with a reason.`
      );
    }
  });

  it('illustrative-path allowlist contains no stale entries', () => {
    const stale = ILLUSTRATIVE_PATH_ALLOWLIST.filter(({ ref }) => fs.existsSync(path.join(REPO_ROOT, ref)));
    if (stale.length > 0) {
      throw new Error(
        `Allowlisted illustrative paths now exist on disk. Remove them from ` +
          `ILLUSTRATIVE_PATH_ALLOWLIST so the test can assert against them normally:\n` +
          stale.map(({ ref }) => `  - \`${ref}\``).join('\n')
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Heading references
// ---------------------------------------------------------------------------
//
// Pattern: a backticked filename ending in .md / .mdc, optionally with `'s`,
// followed by either a double-quoted heading or `§ heading`.

const HEADING_REF_QUOTE_RE = /`([A-Za-z_./-]+\.(?:md|mdc))`(?:'s)?\s+"([^"\n]{2,120})"/g;
const HEADING_REF_SIGIL_RE = /`([A-Za-z_./-]+\.(?:md|mdc))`(?:'s)?\s+§\s*([A-Za-z][A-Za-z0-9 _'-]{1,80})/g;

function collectHeadings(absPath: string): Set<string> {
  const out = new Set<string>();
  const content = fs.readFileSync(absPath, 'utf-8');
  for (const m of content.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)) {
    if (m[1] !== undefined) {
      out.add(normalizeHeading(m[1]));
    }
  }
  return out;
}

function normalizeHeading(s: string): string {
  // Headings may contain inline backticks (e.g. "Backend architecture (`pkg/`)").
  // Compare on a normalized form: lowercased, whitespace collapsed, no
  // surrounding/redundant punctuation.
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function resolveHeadingTarget(refFile: string, citingLabel: string): string | null {
  // Heading refs may be bare ("AGENTS.md") or scoped (".cursor/rules/foo.mdc").
  // Bare names resolve against the repo root; scoped names resolve as-is.
  const direct = path.join(REPO_ROOT, refFile);
  if (fs.existsSync(direct)) {
    return direct;
  }
  // Try resolving relative to the citing file's directory as a fallback.
  const sibling = path.join(REPO_ROOT, path.dirname(citingLabel), refFile);
  if (fs.existsSync(sibling)) {
    return sibling;
  }
  return null;
}

describe('Skill/rule reference graph — heading refs', () => {
  const files = loadProseFiles();
  const headingCache = new Map<string, Set<string>>();

  function getHeadings(abs: string): Set<string> {
    let cached = headingCache.get(abs);
    if (!cached) {
      cached = collectHeadings(abs);
      headingCache.set(abs, cached);
    }
    return cached;
  }

  it.each(files.map((f) => [f.label, f] as const))(
    '%s: every adjacent heading ref resolves to a real heading',
    (_label, file) => {
      const broken: Array<{ refFile: string; heading: string; why: string }> = [];

      const matches: Array<{ refFile: string; heading: string }> = [];
      for (const m of file.stripped.matchAll(HEADING_REF_QUOTE_RE)) {
        const refFile = m[1];
        const heading = m[2];
        if (refFile !== undefined && heading !== undefined) {
          matches.push({ refFile, heading });
        }
      }
      for (const m of file.stripped.matchAll(HEADING_REF_SIGIL_RE)) {
        const refFile = m[1];
        const heading = m[2];
        if (refFile !== undefined && heading !== undefined) {
          matches.push({ refFile, heading });
        }
      }

      for (const { refFile, heading } of matches) {
        const targetAbs = resolveHeadingTarget(refFile, file.label);
        if (!targetAbs) {
          broken.push({ refFile, heading, why: 'target file not found' });
          continue;
        }
        const headings = getHeadings(targetAbs);
        if (!headings.has(normalizeHeading(heading))) {
          broken.push({ refFile, heading, why: 'heading not found in target' });
        }
      }

      if (broken.length > 0) {
        const lines = broken.map(({ refFile, heading, why }) => `  - \`${refFile}\` "${heading}" — ${why}`);
        throw new Error(
          `${file.label} references headings that no longer resolve:\n${lines.join('\n')}\n\n` +
            `Either update the heading citation to match the renamed heading, or restore ` +
            `the heading in the target file.`
        );
      }
    }
  );
});

// ---------------------------------------------------------------------------
// 3. Code ID references
// ---------------------------------------------------------------------------
//
// F1–F6 (frontend security), R1–R21 (React antipatterns), QC1–QC8 (quality),
// G1–G7 (Go backend). Each has a canonical source-of-truth file. Any prose
// reference to an ID must resolve to a defined ID in that file.

interface CodeIdSpec {
  prefix: 'F' | 'R' | 'QC' | 'G';
  canonicalFile: string;
}

const CODE_ID_SPECS: CodeIdSpec[] = [
  { prefix: 'F', canonicalFile: '.cursor/rules/frontend-security.mdc' },
  { prefix: 'R', canonicalFile: '.cursor/rules/react-antipatterns.mdc' },
  { prefix: 'QC', canonicalFile: 'docs/design/PR_REVIEW.md' },
  { prefix: 'G', canonicalFile: 'docs/design/PR_REVIEW.md' },
];

/**
 * Specific ID tokens that look like a code ID but appear in unrelated
 * contexts. Each entry must include a `reason`.
 */
const ID_TOKEN_ALLOWLIST: Array<{ token: string; reason: string }> = [
  { token: 'R98', reason: 'Git `--name-status` rename indicator (`R<percent>`) in prevent-doc-drift example.' },
];

const ALLOWLISTED_TOKENS = new Set(ID_TOKEN_ALLOWLIST.map((e) => e.token));

function loadCanonicalIds(spec: CodeIdSpec): Set<string> {
  const abs = path.join(REPO_ROOT, spec.canonicalFile);
  const content = fs.readFileSync(abs, 'utf-8');
  const ids = new Set<string>();
  const headingRe = new RegExp(`^#+\\s+(${spec.prefix}\\d+)\\b`, 'gm');
  for (const m of content.matchAll(headingRe)) {
    if (m[1] !== undefined) {
      ids.add(m[1]);
    }
  }
  const tableRe = new RegExp(`\\|\\s*(${spec.prefix}\\d+)\\s*\\|`, 'g');
  for (const m of content.matchAll(tableRe)) {
    if (m[1] !== undefined) {
      ids.add(m[1]);
    }
  }
  return ids;
}

function getCanonicalIds(canon: Record<CodeIdSpec['prefix'], Set<string>>, prefix: string): Set<string> | undefined {
  if (prefix === 'F' || prefix === 'R' || prefix === 'QC' || prefix === 'G') {
    return canon[prefix];
  }
  return undefined;
}

// Match either a bare ID (F1, R10, QC7, G3) or a numeric range (R1-R21, F1–F6).
// Use a non-word boundary on both sides so we don't pick up R1 inside a longer
// token like "R1A". The leading `(?<![A-Za-z0-9])` is a manual lookbehind.
const ID_OCCURRENCE_RE = /(?<![A-Za-z0-9])(F|R|QC|G)(\d+)(?:\s*[-–]\s*(?:(F|R|QC|G))?(\d+))?(?![A-Za-z0-9])/g;

describe('Skill/rule reference graph — code IDs', () => {
  const [fSpec, rSpec, qcSpec, gSpec] = CODE_ID_SPECS;
  if (!fSpec || !rSpec || !qcSpec || !gSpec) {
    throw new Error('CODE_ID_SPECS is missing required entries');
  }
  const canon: Record<CodeIdSpec['prefix'], Set<string>> = {
    F: loadCanonicalIds(fSpec),
    R: loadCanonicalIds(rSpec),
    QC: loadCanonicalIds(qcSpec),
    G: loadCanonicalIds(gSpec),
  };

  // Sanity-check that canonical loaders actually found something. If a
  // canonical file gets renamed and our spec doesn't update, we'd otherwise
  // silently start passing.
  it.each(CODE_ID_SPECS)('canonical $prefix-codes are defined in $canonicalFile', (spec) => {
    expect(canon[spec.prefix].size).toBeGreaterThan(0);
  });

  const files = loadProseFiles();

  it.each(files.map((f) => [f.label, f] as const))(
    '%s: every F/R/QC/G code reference resolves to its canonical definition',
    (_label, file) => {
      const broken: Array<{ token: string; context: string }> = [];
      const seen = new Set<string>();

      for (const m of file.stripped.matchAll(ID_OCCURRENCE_RE)) {
        const match = m[0];
        const prefix1 = m[1];
        const lo = m[2];
        const prefix2 = m[3];
        const hi = m[4];
        if (prefix1 === undefined || lo === undefined) {
          continue;
        }
        const ids: string[] = [`${prefix1}${lo}`];
        if (hi !== undefined) {
          ids.push(`${prefix2 ?? prefix1}${hi}`);
        }
        for (const id of ids) {
          if (seen.has(id)) {
            continue;
          }
          seen.add(id);
          if (ALLOWLISTED_TOKENS.has(id)) {
            continue;
          }
          const prefixMatch = id.match(/^(F|R|QC|G)/);
          const idSet = prefixMatch ? getCanonicalIds(canon, prefixMatch[1] ?? '') : undefined;
          if (!idSet || !idSet.has(id)) {
            broken.push({ token: id, context: match });
          }
        }
      }

      if (broken.length > 0) {
        const lines = broken.map(({ token, context }) => `  - \`${token}\` (matched in "${context}")`);
        throw new Error(
          `${file.label} references code IDs that are not defined in their canonical source:\n${lines.join('\n')}\n\n` +
            `Either fix the citation, define the ID in the canonical file, or — if the ` +
            `token is a false positive (e.g. an unrelated identifier that happens to ` +
            `match the F/R/QC/G shape) — add it to ID_TOKEN_ALLOWLIST in ` +
            `src/validation/skill-references.test.ts with a reason.`
        );
      }
    }
  );

  it('code-ID allowlist contains no stale entries', () => {
    const stale: string[] = [];
    for (const { token } of ID_TOKEN_ALLOWLIST) {
      const prefixMatch = token.match(/^(F|R|QC|G)/);
      const idSet = prefixMatch ? getCanonicalIds(canon, prefixMatch[1] ?? '') : undefined;
      if (idSet && idSet.has(token)) {
        stale.push(token);
      }
    }
    if (stale.length > 0) {
      throw new Error(
        `Allowlisted code IDs are now real canonical IDs. Remove them from ` +
          `ID_TOKEN_ALLOWLIST so the test asserts against them normally: ${stale.join(', ')}`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Negative-test fixtures: confirm the parser/comparison logic actually
// detects breakage on a hand-crafted bad input. Keeps the assertion path
// exercised even when every real prose file happens to be clean.
// ---------------------------------------------------------------------------

describe('Skill/rule reference graph — self-tests', () => {
  it('detects a missing path ref in a synthetic prose fragment', () => {
    const fragment = 'See `docs/developer/THIS_DOES_NOT_EXIST.md` for details.';
    const matches = [...fragment.matchAll(PATH_REF_RE)].map((m) => m[1]);
    expect(matches).toContain('docs/developer/THIS_DOES_NOT_EXIST.md');
    expect(fs.existsSync(path.join(REPO_ROOT, 'docs/developer/THIS_DOES_NOT_EXIST.md'))).toBe(false);
  });

  it('detects a missing heading ref in a synthetic prose fragment', () => {
    const fragment = '`AGENTS.md` "Section That Does Not Exist" — should fail.';
    const matches = [...fragment.matchAll(HEADING_REF_QUOTE_RE)];
    expect(matches.length).toBe(1);
    const first = matches[0];
    expect(first).toBeDefined();
    const refFile = first![1];
    const heading = first![2];
    expect(refFile).toBeDefined();
    expect(heading).toBeDefined();
    const targetAbs = resolveHeadingTarget(refFile!, 'fake.md');
    expect(targetAbs).not.toBeNull();
    const headings = collectHeadings(targetAbs!);
    expect(headings.has(normalizeHeading(heading!))).toBe(false);
  });

  it('strips fenced code blocks before scanning', () => {
    const input = ['Real ref: `src/module.ts`.', '```', 'Fake ref: `src/does-not-exist.ts`', '```'].join('\n');
    const stripped = stripFencedCodeBlocks(input);
    const matches = [...stripped.matchAll(PATH_REF_RE)].map((m) => m[1]);
    expect(matches).toContain('src/module.ts');
    expect(matches).not.toContain('src/does-not-exist.ts');
  });
});
