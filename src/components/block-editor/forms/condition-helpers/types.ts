/**
 * Shared type for per-prefix helper components inside `ConditionChipsField`.
 *
 * Each helper takes the current argument value (everything after the
 * prefix) and emits the new value via `onChange`. Helpers may also signal
 * that the argument is invalid via `onValidityChange` so the parent can
 * disable the "Add" button until the input is well-formed.
 */
export interface ConditionHelperProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  onValidityChange?: (isValid: boolean) => void;
  testId?: string;
}
