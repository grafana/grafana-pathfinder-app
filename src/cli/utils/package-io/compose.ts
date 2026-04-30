/**
 * The validate-on-write core. `mutateAndValidate(dir, mutator)` reads the
 * package, hands the parsed state to `mutator` (which mutates in place),
 * runs `validatePackageState`, and only persists if validation passes.
 *
 * This is the single place the "schema-illegal output is impossible"
 * property is enforced for the CLI. Commands should not write packages by
 * any other path.
 */

import { readPackage, writePackage, type PackageState } from './disk';
import { validatePackageState, type ValidationOutcome } from './state-validation';

export interface MutationContext extends PackageState {}
export type Mutator = (state: MutationContext) => void | Promise<void>;

export interface MutationResult {
  state: PackageState;
  validation: ValidationOutcome;
}

/**
 * Read → mutate → validate → write.
 *
 * If validation fails the on-disk state is untouched and the validation
 * issues are returned for the caller to surface; the caller decides whether
 * to throw, render structured JSON, or print human-readable text.
 */
export async function mutateAndValidate(packageDir: string, mutator: Mutator): Promise<MutationResult> {
  const state = readPackage(packageDir);
  await mutator(state);

  const validation = validatePackageState(state.content, state.manifest, {
    manifestSchemaVersionAuthored: state.manifestSchemaVersionAuthored,
  });
  if (validation.ok) {
    writePackage(packageDir, state);
  }
  return { state, validation };
}
