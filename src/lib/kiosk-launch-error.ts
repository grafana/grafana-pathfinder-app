export type KioskLaunchFailureReason =
  | 'unsupported-destination'
  | 'fetch-failed'
  | 'unparseable'
  | 'schema-invalid'
  | 'input-format-mismatch'
  | 'incompatible-input'
  | 'unsupported-validation'
  | 'unsafe-code'
  | 'unsafe-attribute'
  | 'unsafe-variable-sink'
  | 'unresolved-snippet'
  | 'variable-field-name';

export class KioskLaunchError extends Error {
  constructor(
    readonly stage: 'destination' | 'prepare',
    readonly reason: KioskLaunchFailureReason,
    message: string
  ) {
    super(message);
    this.name = 'KioskLaunchError';
  }
}
