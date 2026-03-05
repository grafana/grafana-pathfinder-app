import { defineConfig } from 'eslint/config';
import baseConfig from './.config/eslint.config.mjs';

// ---------------------------------------------------------------------------
// Phase 5: Tier model constants (Epic #603)
// Mirror of TIER_MAP from src/validation/import-graph.ts.
// Keep in sync — the ratchet tests in architecture.test.ts are the source of
// truth; these rules provide faster editor-time feedback on the same boundaries.
// ---------------------------------------------------------------------------

const TIER_2_ENGINES = [
  'context-engine',
  'docs-retrieval',
  'interactive-engine',
  'requirements-manager',
  'learning-paths',
  'package-engine',
];
const TIER_1_PLUS = [
  'lib',
  'security',
  'styles',
  'global-state',
  'utils',
  'validation',
  ...TIER_2_ENGINES,
  'integrations',
  'components',
  'pages',
];
const TIER_2_PLUS = [...TIER_2_ENGINES, 'integrations', 'components', 'pages'];
const TIER_3_PLUS = ['integrations', 'components', 'pages'];
const TIER_4 = ['components', 'pages'];

/**
 * Build a regex pattern that matches relative imports escaping to a banned
 * top-level directory. Matches `../dir`, `../../dir`, etc. but NOT `./dir`
 * (same-module sub-directory).
 *
 * Known limitation: a file in engine/sub-a/ importing ../sub-b/ where sub-b
 * shares a name with a banned top-level dir would false-positive. This only
 * affects docs-retrieval/components/ today and is extremely unlikely to occur
 * from a sibling sub-directory.
 */
function bannedDirRegex(dirs) {
  return `^\\.\\./+(\\.\\./)*(?:${dirs.join('|')})(/|$)`;
}

const TEST_UTILS_PATTERN = {
  regex: bannedDirRegex(['test-utils']),
  message: 'Production code must not import from test-utils/. Test helpers are for test files only.',
};

/**
 * Build a config block for a set of source directories with the given
 * import restriction patterns. The test-utils ban is always included —
 * this avoids a separate global block that would override the tier-specific
 * patterns (ESLint flat config: last matching rule wins for same rule name).
 */
function tierBoundaryConfig(sourceDirs, patterns) {
  return {
    files: sourceDirs.map((d) => `src/${d}/**/*.{ts,tsx}`),
    ignores: ['**/*.test.*', '**/*.spec.*'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['moment'],
          patterns: [...patterns, TEST_UTILS_PATTERN],
        },
      ],
    },
  };
}

export default defineConfig([
  {
    ignores: [
      '**/logs',
      '**/*.log',
      '**/npm-debug.log*',
      '**/yarn-debug.log*',
      '**/yarn-error.log*',
      '**/.pnpm-debug.log*',
      '**/node_modules/',
      '.yarn/cache',
      '.yarn/unplugged',
      '.yarn/build-state.yml',
      '.yarn/install-state.gz',
      '**/.pnp.*',
      '**/pids',
      '**/*.pid',
      '**/*.seed',
      '**/*.pid.lock',
      '**/lib-cov',
      '**/coverage',
      '**/dist/',
      '**/artifacts/',
      '**/work/',
      '**/ci/',
      'test-results/',
      'playwright-report/',
      'blob-report/',
      'playwright/.cache/',
      'playwright/.auth/',
      '**/.idea',
      '**/.eslintcache',
      '**/.DS_Store',
      '**/.hippo',
      '**/temp/',
      '**/plans/',
    ],
  },
  ...baseConfig,

  // Phase 6: Security and architecture lint rules (Epic #603)
  // Mechanically enforce security patterns (F1, F5) and architecture patterns.
  // Test files are excluded — they legitimately use innerHTML for DOM setup/teardown.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.*', '**/*.spec.*'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message:
            'Avoid dangerouslySetInnerHTML — it bypasses React and risks XSS (F1). ' +
            'Use sanitizeDocumentationHTML() with parseHTMLToComponents() instead. ' +
            'If raw HTML injection is truly needed, wrap with sanitizeDocumentationHTML() and add an eslint-disable with justification.',
        },
        {
          selector: "AssignmentExpression[left.property.name='innerHTML']",
          message:
            'Avoid .innerHTML assignment — it bypasses React and risks XSS (F5). ' +
            'Use textContent for plain text, or sanitizeDocumentationHTML() if HTML structure is required.',
        },
        {
          selector: "ClassDeclaration[superClass.name='Component']",
          message:
            'Use function components with hooks instead of class components. ' +
            'Exception: error boundaries require componentDidCatch which has no hook equivalent.',
        },
        {
          selector: "ClassDeclaration[superClass.name='PureComponent']",
          message: 'Use function components with React.memo() instead of PureComponent.',
        },
        {
          selector: "ClassDeclaration[superClass.property.name='Component']",
          message:
            'Use function components with hooks instead of class components. ' +
            'Exception: error boundaries require componentDidCatch which has no hook equivalent.',
        },
        {
          selector: "ClassDeclaration[superClass.property.name='PureComponent']",
          message: 'Use function components with React.memo() instead of PureComponent.',
        },
        {
          selector: "JSXAttribute[name.name='draggable']:not([value.expression.value=false])",
          message:
            'Use @dnd-kit instead of the native HTML5 draggable attribute. ' +
            'See components/block-editor/dnd-helpers.tsx for patterns. ' +
            'draggable={false} to suppress native drag is acceptable.',
        },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // Phase 5: Import boundary rules (Epic #603)
  // Encode the tier model as lint rules. Known violations have targeted
  // suppression comments referencing ALLOWED_*_VIOLATIONS in
  // architecture.test.ts. New violations are caught at editor time.
  // ---------------------------------------------------------------------------

  // Tier 0 (types/, constants/) — no imports from Tier 1+
  tierBoundaryConfig(
    ['types', 'constants'],
    [
      {
        regex: bannedDirRegex(TIER_1_PLUS),
        message:
          'Tier 0 (types/, constants/) must not import from higher tiers. ' +
          'These are foundational modules — move shared logic downward or define it here.',
      },
    ]
  ),

  // Tier 1 (lib/, security/, styles/, global-state/, utils/, validation/) — no imports from Tier 2+
  tierBoundaryConfig(
    ['lib', 'security', 'styles', 'global-state', 'utils', 'validation'],
    [
      {
        regex: bannedDirRegex(TIER_2_PLUS),
        message:
          'Tier 1 (lib/, security/, styles/, utils/) must not import from Tier 2+ modules. ' +
          'Move shared logic to types/ or lib/. See TIER_MAP in src/validation/import-graph.ts.',
      },
    ]
  ),

  // Tier 2 engines — no imports from Tier 3+ (vertical) or other engines (lateral)
  ...TIER_2_ENGINES.map((engine) => {
    const otherEngines = TIER_2_ENGINES.filter((e) => e !== engine);
    return tierBoundaryConfig(
      [engine],
      [
        {
          regex: bannedDirRegex(TIER_3_PLUS),
          message:
            'Tier 2 engines must not import from Tier 3-4 (integrations/, components/, pages/). ' +
            'Use dependency injection or move shared types downward. ' +
            'See ALLOWED_VERTICAL_VIOLATIONS in architecture.test.ts for documented exceptions.',
        },
        {
          regex: bannedDirRegex(otherEngines),
          message:
            'Tier 2 engines should not import from other Tier 2 engines. ' +
            'Extract shared types to types/ or lib/, or use dependency injection. ' +
            'See ALLOWED_LATERAL_VIOLATIONS in architecture.test.ts for documented exceptions.',
        },
      ]
    );
  }),

  // Tier 3 (integrations/) — no imports from Tier 4
  tierBoundaryConfig(
    ['integrations'],
    [
      {
        regex: bannedDirRegex(TIER_4),
        message:
          'Tier 3 (integrations/) must not import from Tier 4 (components/, pages/). ' +
          'Integrations must not depend on presentation-layer modules.',
      },
    ]
  ),

  // Tier 4 (components/, pages/) — no upward tier restrictions, but test-utils ban applies
  tierBoundaryConfig(['components', 'pages'], []),
]);
