/**
 * Skill / rule reference graph tests.
 *
 * Walks every agent-facing prose file in the repo — `.cursor/skills/*\/SKILL.md`,
 * `.claude/skills/*\/SKILL.md`, `.cursor/rules/*.mdc`, `AGENTS.md`, `CLAUDE.md` —
 * and asserts that the things those files point at still exist:
 *
 *   1. Repo path refs (in backticks) resolve to a real file on disk.
 *   2. Adjacent heading refs (`` `<file>.md` "<heading>" `` or `` `<file>.md` § <heading> ``)
 *      resolve to a real heading in the target file.
 *   3. Code IDs (F1–F6, R1–R21, QC1–QC8, G1–G7) are defined in their
 *      canonical source-of-truth file.
 *   4. Every `.cursor/skills/` body has a matching `.claude/skills/` pointer stub
 *      with identical frontmatter, and vice versa.
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

const SKILL_SOURCE_DIR = '.cursor/skills';
const SKILL_STUB_DIR = '.claude/skills';

function skillNamesIn(relDir: string): string[] {
  const abs = path.join(REPO_ROOT, relDir);
  if (!fs.existsSync(abs)) {
    return [];
  }
  return fs
    .readdirSync(abs)
    .filter((name) => fs.existsSync(path.join(abs, name, 'SKILL.md')))
    .sort();
}

function loadProseFiles(): ProseFile[] {
  const out: ProseFile[] = [];

  for (const relDir of [SKILL_SOURCE_DIR, SKILL_STUB_DIR]) {
    for (const name of skillNamesIn(relDir)) {
      const rel = `${relDir}/${name}/SKILL.md`;
      out.push(makeProseFile(rel, path.join(REPO_ROOT, rel)));
    }
  }

  const rulesDir = path.join(REPO_ROOT, '.cursor', 'rules');
  for (const name of fs.readdirSync(rulesDir).sort()) {
    if (name.endsWith('.mdc')) {
      out.push(makeProseFile(`.cursor/rules/${name}`, path.join(rulesDir, name)));
      continue;
    }
    // Rule sets too large to load whole are split into a subdirectory beside
    // their index. Walk those too, or their refs go unvalidated.
    const nested = path.join(rulesDir, name);
    if (!fs.statSync(nested).isDirectory()) {
      continue;
    }
    for (const child of fs.readdirSync(nested).sort()) {
      if (child.endsWith('.mdc')) {
        out.push(makeProseFile(`.cursor/rules/${name}/${child}`, path.join(nested, child)));
        continue;
      }
      // The walk is deliberately one level deep. A rule buried deeper would
      // escape every check in this file, so refuse to walk instead.
      if (fs.statSync(path.join(nested, child)).isDirectory()) {
        throw new Error(
          `.cursor/rules/${name}/${child}/ nests rules two levels deep, which this walker does not ` +
            `reach — its path, heading, and code-ID references would go unvalidated. Flatten it into ` +
            `.cursor/rules/${name}/, or extend loadProseFiles() to recurse.`
        );
      }
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
  /`((?:\.cursor\/(?:skills|rules)|\.claude\/skills|docs\/(?:design|developer)|src|pkg|scripts|\.github)\/[A-Za-z0-9_./@-]+|AGENTS\.md|CLAUDE\.md|CHANGELOG\.md|README\.md|package\.json|tsconfig\.json|eslint\.config\.mjs|playwright\.config\.ts|Magefile\.go)(?::\d+)?(?:#[A-Za-z0-9_-]+)?`/g;

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
// 4. Skill stub parity
// ---------------------------------------------------------------------------
//
// Skill bodies live in `.cursor/skills/` so Cursor can read them. Claude Code
// only discovers skills under `.claude/skills/`, so each body has a committed
// pointer stub there carrying the same frontmatter. Two directories means two
// chances to drift; these assertions close that gap. The name-set equality also
// catches a personal skill accidentally committed into `.claude/skills/`, which
// `.gitignore` deliberately no longer blocks.

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n/;

function readFrontmatter(rel: string): string {
  const raw = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf-8');
  const m = raw.match(FRONTMATTER_RE);
  if (!m || m[1] === undefined) {
    throw new Error(`${rel} has no YAML frontmatter block.`);
  }
  return m[1];
}

describe('Skill stub parity — .cursor/skills ↔ .claude/skills', () => {
  const sourceNames = skillNamesIn(SKILL_SOURCE_DIR);
  const stubNames = skillNamesIn(SKILL_STUB_DIR);

  it('does not introduce an unsupported .agents skill root', () => {
    expect(fs.existsSync(path.join(REPO_ROOT, '.agents'))).toBe(false);
  });

  it('at least one skill is discovered', () => {
    expect(sourceNames.length).toBeGreaterThan(0);
  });

  it('both directories hold exactly the same skill names', () => {
    const missingStub = sourceNames.filter((n) => !stubNames.includes(n));
    const orphanStub = stubNames.filter((n) => !sourceNames.includes(n));

    const problems: string[] = [];
    if (missingStub.length > 0) {
      problems.push(
        `Missing pointer stubs (Claude Code cannot see these skills):\n` +
          missingStub.map((n) => `  - ${SKILL_STUB_DIR}/${n}/SKILL.md`).join('\n')
      );
    }
    if (orphanStub.length > 0) {
      problems.push(
        `Stubs with no ${SKILL_SOURCE_DIR} body (delete the stub, or add the body if the skill is real). ` +
          `A personal skill you do not want committed belongs in ~/.claude/skills/, which is outside the repo:\n` +
          orphanStub.map((n) => `  - ${SKILL_STUB_DIR}/${n}/SKILL.md`).join('\n')
      );
    }

    if (problems.length > 0) {
      throw new Error(
        `${SKILL_SOURCE_DIR} and ${SKILL_STUB_DIR} are out of sync:\n\n${problems.join('\n\n')}\n\n` +
          `Every skill needs both: the body in ${SKILL_SOURCE_DIR}/<name>/SKILL.md and a pointer ` +
          `stub in ${SKILL_STUB_DIR}/<name>/SKILL.md whose frontmatter matches it.`
      );
    }
  });

  const paired = sourceNames.filter((n) => stubNames.includes(n));

  it.each(paired)('%s: stub frontmatter matches its source verbatim', (name) => {
    const sourceRel = `${SKILL_SOURCE_DIR}/${name}/SKILL.md`;
    const stubRel = `${SKILL_STUB_DIR}/${name}/SKILL.md`;
    expect(readFrontmatter(stubRel)).toBe(readFrontmatter(sourceRel));
  });

  it.each(paired)('%s: stub body points at its source', (name) => {
    const sourceRel = `${SKILL_SOURCE_DIR}/${name}/SKILL.md`;
    const stubRel = `${SKILL_STUB_DIR}/${name}/SKILL.md`;
    const body = fs.readFileSync(path.join(REPO_ROOT, stubRel), 'utf-8').replace(FRONTMATTER_RE, '');
    expect(body).toContain(`\`${sourceRel}\``);
  });

  it.each(paired)('%s: frontmatter declares a name matching its directory', (name) => {
    // Anchored: a substring match would let directory `review` pass on `name: reviewer`.
    const declared = new RegExp(`^name: ${name}\\s*$`, 'm');
    expect(readFrontmatter(`${SKILL_SOURCE_DIR}/${name}/SKILL.md`)).toMatch(declared);
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

// ---------------------------------------------------------------------------
// Split rule-set parity: index table ↔ themed detail files
// ---------------------------------------------------------------------------
//
// `react-antipatterns.mdc` is an index whose table names every R-code and
// routes it to a themed file holding the actual rule. Two surfaces means a
// rule can be dropped in a move and still look present in the index — which
// is exactly what the reader would trust. Assert the sets match.

const RA_INDEX = '.cursor/rules/react-antipatterns.mdc';
const RA_DETAIL_DIR = '.cursor/rules/react-antipatterns';

describe('Split rule-set parity — react-antipatterns index ↔ detail files', () => {
  const indexCodes = [
    ...new Set(
      [...fs.readFileSync(path.join(REPO_ROOT, RA_INDEX), 'utf-8').matchAll(/\|\s*(R\d+)\s*\|/g)].map((m) => m[1]!)
    ),
  ];

  const detailCodes = new Map<string, string>();
  const duplicates: Array<{ code: string; files: string[] }> = [];
  for (const file of fs.readdirSync(path.join(REPO_ROOT, RA_DETAIL_DIR)).sort()) {
    if (!file.endsWith('.mdc')) {
      continue;
    }
    const content = fs.readFileSync(path.join(REPO_ROOT, RA_DETAIL_DIR, file), 'utf-8');
    for (const m of content.matchAll(/^## (R\d+) — /gm)) {
      const code = m[1]!;
      const existing = detailCodes.get(code);
      if (existing !== undefined) {
        duplicates.push({ code, files: [existing, file] });
        continue;
      }
      detailCodes.set(code, file);
    }
  }

  it('index table is non-empty', () => {
    expect(indexCodes.length).toBeGreaterThan(0);
  });

  it('no rule is defined in more than one detail file', () => {
    if (duplicates.length > 0) {
      throw new Error(
        `A rule must live in exactly one file:\n` +
          duplicates.map(({ code, files }) => `  - ${code} is defined in both ${files.join(' and ')}`).join('\n')
      );
    }
  });

  it('every code in the index table has a rule in a detail file', () => {
    const orphans = indexCodes.filter((c) => !detailCodes.has(c));
    if (orphans.length > 0) {
      throw new Error(
        `${RA_INDEX} routes codes that no detail file defines: ${orphans.join(', ')}.\n` +
          `Add a \`## <code> — <title>\` section in the themed file the index points at, ` +
          `or remove the row.`
      );
    }
  });

  it('every rule in a detail file is listed in the index table', () => {
    const unlisted = [...detailCodes.entries()].filter(([code]) => !indexCodes.includes(code));
    if (unlisted.length > 0) {
      throw new Error(
        `Rules exist but are unreachable from ${RA_INDEX}:\n` +
          unlisted.map(([code, file]) => `  - ${code} (in ${file})`).join('\n') +
          `\nAdd a row to the index table so the rule can be found.`
      );
    }
  });

  it('the index routes each code to the file that actually defines it', () => {
    const rows = [
      ...fs
        .readFileSync(path.join(REPO_ROOT, RA_INDEX), 'utf-8')
        .matchAll(/\|\s*(R\d+)\s*\|[^|]*\|[^|]*\|\s*`([^`]+)`\s*\|/g),
    ];
    expect(rows.length).toBe(indexCodes.length);

    const misrouted = rows
      .map((m) => ({ code: m[1]!, target: m[2]! }))
      .filter(({ code, target }) => {
        const actual = detailCodes.get(code);
        return actual !== undefined && target !== `${RA_DETAIL_DIR}/${actual}`;
      });

    if (misrouted.length > 0) {
      throw new Error(
        `${RA_INDEX} points at the wrong file for:\n` +
          misrouted
            .map(({ code, target }) => `  - ${code}: index says \`${target}\`, rule is in ${detailCodes.get(code)}`)
            .join('\n')
      );
    }
  });
});
