import {
  ALIGNED_BY_CONSTRUCTION_SOURCES,
  NEEDS_ALIGNMENT_CHECK_SOURCES,
  coerceLaunchSource,
  isAlignedByConstruction,
  type LaunchSource,
} from './launch-sources';

/**
 * Static enumeration of every literal in the `LaunchSource` union.
 *
 * This list is duplicated from the type definition on purpose: it lets us
 * write coverage tests that fail loudly the moment a new literal is added
 * to the union but not classified into one of the two sets. The
 * `assertExhaustive` line at the bottom of this constant is what triggers
 * the type error if the two ever drift.
 */
const ALL_LAUNCH_SOURCES = [
  // Aligned-by-construction
  'recommender',
  'browser_restore',
  'internal_reload',
  'mcp_launch',
  'navigate-action',
  'grot_guide_block',
  'experiment_treatment',
  'experiment_treatment_navigation',
  'auto_open',
  'floating_panel_dock',
  'live_session_attendee',
  'devtools',
  // Needs alignment check
  'home_page',
  'url_param',
  'learning-hub',
  'command_palette',
  'command_palette_help',
  'command_palette_learn',
  'external_suggestion',
  'link_interception',
  'queued_link',
  'content_link',
  'location_change',
  'block_editor_preview',
  'custom_guide',
] as const satisfies readonly LaunchSource[];

// Compile-time guard: if `LaunchSource` gains a new literal that is not in
// `ALL_LAUNCH_SOURCES`, `assertExhaustive` fails to compile. This forces
// authors to think about the classification at the moment they add a source.
type Exhaustive = Exclude<LaunchSource, (typeof ALL_LAUNCH_SOURCES)[number]>;
const _assertExhaustive: Exhaustive extends never ? true : false = true;
void _assertExhaustive;

describe('isAlignedByConstruction', () => {
  it('returns true for every aligned-by-construction source', () => {
    for (const source of ALIGNED_BY_CONSTRUCTION_SOURCES) {
      expect(isAlignedByConstruction(source)).toBe(true);
    }
  });

  it('returns false for every needs-alignment-check source', () => {
    for (const source of NEEDS_ALIGNMENT_CHECK_SOURCES) {
      expect(isAlignedByConstruction(source)).toBe(false);
    }
  });

  it('returns false for an unknown source (default to evaluating alignment)', () => {
    expect(isAlignedByConstruction('some_new_surface')).toBe(false);
  });

  it('returns false when source is undefined', () => {
    expect(isAlignedByConstruction(undefined)).toBe(false);
  });

  it('returns false when source is the empty string', () => {
    expect(isAlignedByConstruction('')).toBe(false);
  });

  it('does not classify any source as both aligned and needing alignment', () => {
    for (const source of ALIGNED_BY_CONSTRUCTION_SOURCES) {
      expect(NEEDS_ALIGNMENT_CHECK_SOURCES.has(source)).toBe(false);
    }
  });
});

describe('LaunchSource exhaustive classification', () => {
  // This is the property-based check the PR review asked for: every literal
  // in the union must be classified into exactly ONE of the two sets. The
  // previous tests only checked one direction (every member of a set
  // classifies correctly); a literal that exists in the type but neither
  // set would pass them silently and produce surprising "needs check"
  // behaviour at runtime.
  it.each(ALL_LAUNCH_SOURCES)('%s is classified into exactly one set', (source) => {
    const inAligned = (ALIGNED_BY_CONSTRUCTION_SOURCES as ReadonlySet<string>).has(source);
    const inNeedsCheck = (NEEDS_ALIGNMENT_CHECK_SOURCES as ReadonlySet<string>).has(source);
    expect([inAligned, inNeedsCheck]).toEqual(
      // XOR: exactly one must be true
      expect.arrayContaining([true, false])
    );
    expect(inAligned && inNeedsCheck).toBe(false);
  });

  it('union of the two sets equals the full LaunchSource union', () => {
    const setUnion = new Set<string>([...ALIGNED_BY_CONSTRUCTION_SOURCES, ...NEEDS_ALIGNMENT_CHECK_SOURCES]);
    expect(setUnion.size).toBe(ALL_LAUNCH_SOURCES.length);
    for (const source of ALL_LAUNCH_SOURCES) {
      expect(setUnion.has(source)).toBe(true);
    }
  });
});

describe('coerceLaunchSource', () => {
  it('returns the literal unchanged for every known source', () => {
    for (const source of ALL_LAUNCH_SOURCES) {
      expect(coerceLaunchSource(source)).toBe(source);
    }
  });

  it('returns null for an unknown literal', () => {
    expect(coerceLaunchSource('typo_recommander')).toBeNull();
    expect(coerceLaunchSource('not_a_real_source')).toBeNull();
  });

  // Regression for the "learning-hub source silently dropped" bug:
  // `learning-hub` is dispatched via the `?doc=foo&source=learning-hub`
  // deep-link path AND used as a routing flag in the auto-launch handlers
  // (`source === 'learning-hub'` → `openLearningJourney`). It used to be
  // missing from the union, which made `coerceLaunchSource` return null
  // and the typed source silently fall through to `undefined` — meaning
  // alignment evaluation classified the launch as "unknown" rather than
  // the appropriate `learning-hub` (needs-check) bucket.
  it('preserves the `learning-hub` deep-link literal', () => {
    expect(coerceLaunchSource('learning-hub')).toBe('learning-hub');
  });

  it('returns null for null, undefined, and empty string', () => {
    expect(coerceLaunchSource(null)).toBeNull();
    expect(coerceLaunchSource(undefined)).toBeNull();
    expect(coerceLaunchSource('')).toBeNull();
  });
});
