/**
 * Type-safe requirement definitions for compile-time checking
 * This prevents unknown requirement types from reaching runtime
 */

// Fixed requirement types (no parameters)
export enum FixedRequirementType {
  EXISTS_REFTARGET = 'exists-reftarget',
  NAVMENU_OPEN = 'navmenu-open',
  HAS_DATASOURCES = 'has-datasources',
  IS_ADMIN = 'is-admin',
  IS_LOGGED_IN = 'is-logged-in',
  IS_EDITOR = 'is-editor',
  DASHBOARD_EXISTS = 'dashboard-exists',
  FORM_VALID = 'form-valid',
  IS_TERMINAL_ACTIVE = 'is-terminal-active',
}

// Parameterized requirement prefixes
export enum ParameterizedRequirementPrefix {
  HAS_PERMISSION = 'has-permission:',
  HAS_ROLE = 'has-role:',
  HAS_DATASOURCE = 'has-datasource:',
  DATASOURCE_CONFIGURED = 'datasource-configured:',
  HAS_PLUGIN = 'has-plugin:',
  PLUGIN_ENABLED = 'plugin-enabled:',
  HAS_DASHBOARD_NAMED = 'has-dashboard-named:',
  ON_PAGE = 'on-page:',
  HAS_FEATURE = 'has-feature:',
  IN_ENVIRONMENT = 'in-environment:',
  MIN_VERSION = 'min-version:',
  SECTION_COMPLETED = 'section-completed:',
  /** Guide response variable check (e.g., var-policyAccepted:true) */
  VARIABLE = 'var-',
  /** Renderer context check (e.g., renderer:pathfinder, renderer:website) */
  RENDERER = 'renderer:',
}

// Helper type for parameterized requirements
export type ParameterizedRequirement = `${ParameterizedRequirementPrefix}${string}`;

// Union type for all valid requirements
export type ValidRequirement = FixedRequirementType | ParameterizedRequirement;

// Helper functions for type checking
export const isFixedRequirement = (req: string): req is FixedRequirementType => {
  return Object.values(FixedRequirementType).includes(req as FixedRequirementType);
};

export const isParameterizedRequirement = (req: string): req is ParameterizedRequirement => {
  return Object.values(ParameterizedRequirementPrefix).some((prefix) => req.startsWith(prefix));
};

export const isValidRequirement = (req: string): req is ValidRequirement => {
  return isFixedRequirement(req) || isParameterizedRequirement(req);
};

// Type-safe requirement checker options
export interface TypeSafeRequirementsCheckOptions {
  requirements: string; // We keep this as string for backward compatibility, but validate at runtime
  targetAction?: string;
  refTarget?: string;
  targetValue?: string;
  stepId?: string;
}

/**
 * All fixed requirement tokens, in the order they should be presented to authors.
 */
export const FIXED_REQUIREMENTS: readonly string[] = Object.freeze(Object.values(FixedRequirementType));

/**
 * All parameterized requirement prefixes (each ends in `:` or `-`).
 */
export const PARAMETERIZED_REQUIREMENT_PREFIXES: readonly string[] = Object.freeze(
  Object.values(ParameterizedRequirementPrefix)
);

/**
 * Examples of each parameterized prefix, suitable for help text.
 */
export const PARAMETERIZED_REQUIREMENT_EXAMPLES: ReadonlyArray<{ prefix: string; example: string }> = Object.freeze([
  { prefix: 'on-page:', example: 'on-page:/dashboards' },
  { prefix: 'has-datasource:', example: 'has-datasource:prometheus' },
  { prefix: 'has-plugin:', example: 'has-plugin:grafana-clock-panel' },
  { prefix: 'has-permission:', example: 'has-permission:dashboards.create' },
  { prefix: 'has-role:', example: 'has-role:editor' },
  { prefix: 'min-version:', example: 'min-version:10.1.0' },
  { prefix: 'section-completed:', example: 'section-completed:intro' },
  { prefix: 'has-feature:', example: 'has-feature:publicDashboards' },
  { prefix: 'in-environment:', example: 'in-environment:cloud' },
  { prefix: 'datasource-configured:', example: 'datasource-configured:prometheus' },
  { prefix: 'plugin-enabled:', example: 'plugin-enabled:grafana-clock-panel' },
  { prefix: 'has-dashboard-named:', example: 'has-dashboard-named:Node Exporter Full' },
  { prefix: 'var-', example: 'var-policyAccepted:true' },
  { prefix: 'renderer:', example: 'renderer:pathfinder' },
]);

/**
 * Levenshtein distance, capped at `max` for early-exit.
 */
function levenshteinDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) {
    return max + 1;
  }
  const m = a.length;
  const n = b.length;
  if (m === 0) {
    return n;
  }
  if (n === 0) {
    return m;
  }
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = new Array<number>(n + 1);
    curr[0] = i;
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
      if (curr[j]! < rowMin) {
        rowMin = curr[j]!;
      }
    }
    if (rowMin > max) {
      return max + 1;
    }
    prev = curr;
  }
  return prev[n]!;
}

/**
 * Suggest the closest valid requirement token for an unknown one.
 * - For tokens that look parameterized (`prefix:value`), suggest a known prefix
 *   if the user got the prefix wrong (e.g., `is-amdin:foo` → `has-role:foo`).
 * - For bare tokens, find the nearest fixed requirement within Levenshtein ≤2.
 * Returns `null` when nothing is close enough.
 */
export function suggestRequirement(token: string): string | null {
  if (!token) {
    return null;
  }
  // Parameterized-looking input: split on first `:` or treat `var-` / `on-page:` style.
  const colonIdx = token.indexOf(':');
  if (colonIdx > 0) {
    const prefix = token.slice(0, colonIdx + 1);
    const value = token.slice(colonIdx + 1);
    let best: { prefix: string; dist: number } | null = null;
    for (const p of PARAMETERIZED_REQUIREMENT_PREFIXES) {
      const d = levenshteinDistance(prefix, p, 3);
      if (d <= 2 && (best === null || d < best.dist)) {
        best = { prefix: p, dist: d };
      }
    }
    if (best && best.prefix !== prefix) {
      return `${best.prefix}${value}`;
    }
    return null;
  }
  // Bare token: closest fixed.
  let best: { token: string; dist: number } | null = null;
  for (const fixed of FIXED_REQUIREMENTS) {
    const d = levenshteinDistance(token, fixed, 2);
    if (d <= 2 && (best === null || d < best.dist)) {
      best = { token: fixed, dist: d };
    }
  }
  return best ? best.token : null;
}

/**
 * Build the canonical "Unknown requirement …" message used by schema
 * refinements and CLI errors. Centralizing here keeps wording stable across
 * the schema layer, the CLI, and the future MCP `pathfinder_help` surface.
 */
export function unknownRequirementMessage(token: string): string {
  const suggestion = suggestRequirement(token);
  const head = `Unknown requirement "${token}"`;
  const tail = `Run "pathfinder-cli requirements list" for valid tokens.`;
  return suggestion ? `${head} — did you mean "${suggestion}"? ${tail}` : `${head}. ${tail}`;
}
