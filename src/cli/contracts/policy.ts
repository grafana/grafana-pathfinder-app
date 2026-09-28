/**
 * Per-parameter policy metadata.
 *
 * Facts *about* a parameter that are not part of its type ride on the field via
 * Zod's `.meta()`, so there is no parallel spec object to keep in sync with it.
 *
 * Nothing about a reader lives here. Which parameters a caller is offered, how
 * they are spelled, which are positional or hidden from help — all of that
 * belongs to the surface serving that caller: the MCP binding declares what it
 * withholds (`mcp/lib/command-interface.ts`), the Commander adapter declares its
 * presentation (`render-commander.ts`).
 *
 * ## Why the reader walks wrappers
 *
 * Zod's registry is keyed by schema *instance*, and each wrapper creates a new
 * one. On Zod 4.4.3:
 *
 *     z.globalRegistry.get(z.string().meta({role:'io'}).optional())  // undefined
 *     z.globalRegistry.get(z.string().optional().meta({role:'io'}))  // {role:'io'}
 *
 * Both spellings are legitimate, and `.partial()` rewraps every field, stripping
 * metadata off the outer instance. So `readParamPolicy` merges metadata from
 * every level of the chain, outermost winning. `.extend()` and `.omit()` reuse
 * field instances, so policy survives those untouched — which is what makes
 * composing a command schema over a shared runtime schema viable.
 */

import { z } from 'zod';

import { wrapperChain } from '../utils/zod-internals';

/**
 * What a parameter is for — a fact about the command, and the coarsest thing a
 * surface can filter on without naming parameters one by one.
 *
 * - `content` — projects into the artifact being authored.
 * - `addressing` — selects *where* in the tree to act (`parent`, `id`, `branch`).
 * - `placement` — structural positioning (`before`, `after`, `position`).
 * - `control` — selects command behaviour rather than content (`cascade`,
 *   `orphanChildren`, `validate`).
 * - `io` — process plumbing (`dir`, `format`, `quiet`): supplied by whatever
 *   invoked the command rather than chosen by the author.
 */
export type ParamRole = 'content' | 'addressing' | 'placement' | 'control' | 'io';

export const PARAM_ROLES: readonly ParamRole[] = ['content', 'addressing', 'placement', 'control', 'io'];

export interface ParamPolicy {
  role: ParamRole;
  /**
   * Outcome code when this parameter is required and absent, in place of the
   * generic `SCHEMA_VALIDATION`. Lets a requirement be stated once in the schema
   * without losing a published code: `CONTAINER_REQUIRES_ID` is part of the
   * `PackageIOErrorCode` contract, so container `id` has to be a real schema
   * requirement *and* still fail under its own name.
   */
  missingCode?: string;
  /**
   * Why this parameter is required, for when it is absent — replacing Zod's
   * type-shaped message ("expected string, received undefined"), which explains the
   * failure without explaining the requirement.
   *
   * Parameter references (`{@id}`) are spelled by whichever surface prints it — `--id`
   * at a command line, `id` to an agent — so the sentence is declared once and lands
   * in each dialect rather than being written in one of them. See `param-spelling`.
   */
  missingMessage?: string;
}

/** Policy as declared, before defaults are applied. */
export type DeclaredPolicy = Partial<ParamPolicy>;

/**
 * Read declared policy off a field, walking the optional/default/nullable
 * chain. Outer declarations win over inner ones.
 */
export function readParamPolicy(field: z.ZodType): DeclaredPolicy {
  const merged: DeclaredPolicy = {};

  for (const link of wrapperChain(field)) {
    const meta = z.globalRegistry.get(link) as DeclaredPolicy | undefined;
    if (meta) {
      // Outward-in: only fill what an outer level did not already declare.
      if (merged.role === undefined && meta.role !== undefined) {
        merged.role = meta.role;
      }
      if (merged.missingCode === undefined && meta.missingCode !== undefined) {
        merged.missingCode = meta.missingCode;
      }
      if (merged.missingMessage === undefined && meta.missingMessage !== undefined) {
        merged.missingMessage = meta.missingMessage;
      }
    }
  }

  return merged;
}

/** Declared policy as a complete policy, or `undefined` if no role was declared. */
export function resolveParamPolicy(field: z.ZodType): ParamPolicy | undefined {
  const declared = readParamPolicy(field);
  if (declared.role === undefined) {
    return undefined;
  }
  return {
    role: declared.role,
    ...(declared.missingCode !== undefined ? { missingCode: declared.missingCode } : {}),
    ...(declared.missingMessage !== undefined ? { missingMessage: declared.missingMessage } : {}),
  };
}
