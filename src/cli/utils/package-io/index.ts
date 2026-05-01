/**
 * Package read/mutate/validate/write core for the authoring CLI.
 *
 * The CLI's defining property — "schema-illegal output is impossible" — is
 * enforced here. Every authoring command composes:
 *
 *   1. readPackage(dir)            → in-memory artifact
 *   2. apply mutator (append, edit, remove)
 *   3. validatePackageState        → Zod + cross-file ID + condition checks
 *   4. writePackage(dir, …)        → only if validation passes
 *
 * The full sequence is exposed as `mutateAndValidate(dir, mutator)`. The
 * mutator primitives (`appendBlock`, `editBlock`, …) are imported from this
 * module too.
 *
 * Internal layering (every module imports only from those listed above it):
 *   1. errors            — stable error codes + PackageIOError
 *   2. tree              — walkers, lookups, container-key constants
 *   3. auto-id           — block-id minting (`<type>-<n>`)
 *   4. state-validation  — validatePackageState + classifiers
 *   5. disk              — readPackage / writePackage
 *   6. mutators          — appendBlock / appendStep / appendChoice / editBlock / removeBlock
 *   7. move              — moveBlock
 *   8. compose           — mutateAndValidate
 *   9. create-state      — newPackageState
 *
 * `resolveAppendTarget` (used by move.ts) and the `--if-absent` equivalence
 * helpers stay internal to this directory and are NOT re-exported.
 */

export { PackageIOError } from './errors';
export type { PackageIOErrorCode, PackageIOIssue } from './errors';

export { walkBlocks, findBlockById, findContainerById, collectAllIds } from './tree';

export { buildArtifactSummary, buildTree, buildChildrenTree } from './summary';
export type { TreeNode } from './summary';

export { nextAutoBlockId, assignMissingIds } from './auto-id';

export { validatePackageState } from './state-validation';
export type { ValidationOutcome, ValidatePackageStateOptions } from './state-validation';

export { readPackage, writePackage } from './disk';
export type { PackageState } from './disk';

export { appendBlock, appendStep, appendChoice, editBlock, removeBlock } from './mutators';
export type { AppendBlockOptions, AppendBlockResult, EditBlockOptions, RemoveBlockOptions } from './mutators';

export { moveBlock } from './move';
export type { MoveBlockOptions, MoveBlockResult } from './move';

export { mutateAndValidate } from './compose';
export type { MutationContext, Mutator, MutationResult } from './compose';

export { newPackageState } from './create-state';
