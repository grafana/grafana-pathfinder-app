/**
 * Reusable symmetry assertion for parity matrices.
 *
 * A parity matrix answers "do N independent code paths that are supposed to
 * agree actually agree?" — without anyone having to decide which one is right.
 * That distinction is the whole point: `assertSymmetric` never compares a value
 * against an expectation, only against the other values in the table. A matrix
 * built this way survives a deliberate change to the right answer (every path
 * moves together and the test stays green) and fires only on disagreement.
 *
 * Guards that make a matrix hard to fake green:
 *   - an empty table fails, so deleting the cases is not a fix;
 *   - a declared path with no adapter fails, so a path cannot be silently
 *     retired by dropping its wiring while its name lingers in the table;
 *   - an `intentionalDifferences` entry that no longer describes a real
 *     divergence fails as stale, so the allowlist cannot rot into a
 *     blanket exemption;
 *   - an `intentionalDifferences` entry missing its paths, reason, or tracking
 *     issue fails, so a divergence cannot be excused without a justification a
 *     reviewer can read. Nothing typechecks `tests/`, so this is enforced at
 *     runtime rather than left to the type.
 *
 * Adapters are resolved one at a time, never concurrently: a stateful adapter
 * may drive process-wide singletons or the document event bus, and two of those
 * running at once would claim each other's consume-once reads and report a
 * disagreement that does not exist.
 */

/** One path's answer. `path` is unique; `family` groups paths that share a producer. */
export interface SymmetryEntry<T> {
  path: string;
  family: string;
  /** `undefined` means "this path declared no adapter" and is always a failure. */
  adapter: (() => T | Promise<T>) | undefined;
}

/**
 * A divergence that is known, accepted, and tracked. Every field is required:
 * an entry without a reason and a tracking issue is indistinguishable from a
 * test someone silenced.
 */
export interface IntentionalDifference {
  /** Paths permitted to sit outside the agreeing majority. */
  paths: readonly string[];
  reason: string;
  /** Issue URL or `owner/repo#123`. */
  tracking: string;
}

export interface SymmetryOptions {
  /** What the paths are being compared on, for the failure message. */
  subject: string;
  intentionalDifferences: readonly IntentionalDifference[];
}

/** Stable key: object keys sorted, so property order never reads as disagreement. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
    }
    return val;
  });
}

interface ResolvedEntry<T> {
  path: string;
  family: string;
  value: T;
  key: string;
}

function fail(lines: string[]): never {
  throw new Error(lines.join('\n'));
}

function isNonEmptyText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonEmptyList(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyText);
}

function describeInvalidDifference(diff: IntentionalDifference | undefined): string {
  if (!diff) {
    return 'entry is missing';
  }
  const missing = [
    isNonEmptyList(diff.paths) ? undefined : 'paths',
    isNonEmptyText(diff.reason) ? undefined : 'reason',
    isNonEmptyText(diff.tracking) ? undefined : 'tracking',
  ].filter((field): field is string => field !== undefined);
  const named = isNonEmptyList(diff.paths) ? `[${diff.paths.join(', ')}]` : '(unnamed)';
  return `${named} missing ${missing.join(', ')}`;
}

/**
 * Resolve every adapter, then assert all answers are identical to each other.
 * Throws with a grouped report naming which paths disagreed and on what.
 */
export async function assertSymmetric<T>(
  entries: readonly SymmetryEntry<T>[],
  options: SymmetryOptions
): Promise<void> {
  const invalidDifferences = options.intentionalDifferences.filter(
    (diff) => !isNonEmptyList(diff?.paths) || !isNonEmptyText(diff?.reason) || !isNonEmptyText(diff?.tracking)
  );
  if (invalidDifferences.length > 0) {
    fail([
      `Incomplete INTENTIONAL_PATH_DIFFERENCES entries for ${options.subject}:`,
      ...invalidDifferences.map((diff, index) => `  - entry ${index + 1}: ${describeInvalidDifference(diff)}`),
      '',
      'Every entry needs at least one path, a reason, and a tracking issue. An entry',
      'without them is indistinguishable from a test someone silenced.',
    ]);
  }

  if (entries.length === 0) {
    fail([
      `Parity matrix for ${options.subject} is empty.`,
      'A matrix with no paths proves nothing. Declare the launch paths it must cover.',
    ]);
  }

  const duplicates = entries.map((e) => e.path).filter((p, i, all) => all.indexOf(p) !== i);
  if (duplicates.length > 0) {
    fail([
      `Parity matrix for ${options.subject} declares duplicate path names: ${[...new Set(duplicates)].join(', ')}`,
    ]);
  }

  const unwired = entries.filter((e) => e.adapter === undefined).map((e) => e.path);
  if (unwired.length > 0) {
    fail([
      `Parity matrix for ${options.subject} declares paths with no adapter:`,
      ...unwired.map((p) => `  - ${p}`),
      '',
      'Every declared path must call the production code for that path. Wire it up,',
      'or remove the declaration and record why the path is out of scope.',
    ]);
  }

  const resolved: Array<ResolvedEntry<T>> = [];
  for (const entry of entries) {
    const value = await entry.adapter!();
    resolved.push({ path: entry.path, family: entry.family, value, key: canonical(value) });
  }

  const groups = new Map<string, ResolvedEntry<T>[]>();
  for (const entry of resolved) {
    const bucket = groups.get(entry.key);
    if (bucket) {
      bucket.push(entry);
    } else {
      groups.set(entry.key, [entry]);
    }
  }

  // The largest group is the working consensus. It carries no authority — it is
  // only the baseline the report measures dissent from.
  const ordered = [...groups.values()].sort((a, b) => b.length - a.length);
  const majority = ordered[0]!;
  const majorityPaths = new Set(majority.map((e) => e.path));
  const dissenting = resolved.filter((e) => !majorityPaths.has(e.path));

  const knownPaths = new Set(resolved.map((e) => e.path));
  const staleEntries = options.intentionalDifferences.filter((diff) =>
    diff.paths.every((p) => !knownPaths.has(p) || majorityPaths.has(p))
  );
  if (staleEntries.length > 0) {
    fail([
      `Stale INTENTIONAL_PATH_DIFFERENCES entries for ${options.subject}`,
      '(these paths now agree with the rest, or no longer exist — remove the entry):',
      ...staleEntries.map((d) => `  - [${d.paths.join(', ')}] ${d.reason} (${d.tracking})`),
    ]);
  }

  const excused = new Set(options.intentionalDifferences.flatMap((d) => d.paths));
  const unexplained = dissenting.filter((e) => !excused.has(e.path));
  if (unexplained.length === 0) {
    return;
  }

  const describe = (entry: ResolvedEntry<T>) => `      ${entry.path}  [${entry.family}]`;
  fail([
    `Launch paths disagree on ${options.subject}.`,
    '',
    `${groups.size} distinct answers across ${resolved.length} paths:`,
    ...ordered.flatMap((group) => ['', `  ${JSON.stringify(group[0]!.value)}`, ...group.map(describe)]),
    '',
    'Unexplained dissent:',
    ...unexplained.map((e) => `  - ${e.path}`),
    '',
    'These paths are supposed to produce the same request for the same guide.',
    'Fix the production code so they agree, or — if a divergence is genuinely',
    'correct — add an INTENTIONAL_PATH_DIFFERENCES entry with a reason and a',
    'tracking issue. Do not narrow the table.',
  ]);
}
