import { validatePackage, type PackageValidationResult } from '../../validation/validate-package';
import { runValidateCli, ValidateCliCommand } from '../commands/validate';

jest.mock('../../validation/validate-package', () => ({
  ...jest.requireActual('../../validation/validate-package'),
  validatePackage: jest.fn(),
}));

const resultWith = (errors: PackageValidationResult['errors']): PackageValidationResult => ({
  isValid: false,
  packageId: 'demo',
  errors,
  warnings: [],
  messages: [],
  contentResult: null,
});

describe('validate --package text output', () => {
  let lines: string[];

  beforeEach(() => {
    lines = [];
    jest.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('prints the Fix line under an error that carries a remediation', async () => {
    jest
      .mocked(validatePackage)
      .mockReturnValue(
        resultWith([
          { message: 'hash missing', path: ['i18n/ja.json'], code: 'x', remediation: 'run sync-translations' },
        ])
      );
    await runValidateCli(ValidateCliCommand.parse({ package: '.' }));

    const errorAt = lines.findIndex((line) => line.includes('ERROR: hash missing'));
    expect(errorAt).toBeGreaterThanOrEqual(0);
    expect(lines[errorAt + 1]).toBe('      Fix: run sync-translations');
  });

  it('prints no Fix line under an error without a remediation', async () => {
    jest.mocked(validatePackage).mockReturnValue(resultWith([{ message: 'broken', path: [], code: 'x' }]));
    await runValidateCli(ValidateCliCommand.parse({ package: '.' }));

    expect(lines.some((line) => line.includes('Fix:'))).toBe(false);
  });
});
