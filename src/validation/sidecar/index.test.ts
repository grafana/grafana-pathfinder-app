import type { SidecarReadFailure } from '../../cli/utils/package-io';
import { validateSidecars } from './index';
import { contextOf, sidecarOf } from '../../test-utils/sidecar-check-context';
import type { SidecarCheck, SidecarCheckContext, SidecarFinding } from './types';

const content = contextOf([]).content;

function checkReturning(findings: SidecarFinding[]): SidecarCheck & { run: jest.Mock } {
  return { id: 'fake', codes: [], run: jest.fn(() => findings) };
}

const failure = (overrides: Partial<SidecarReadFailure>): SidecarReadFailure => ({
  ok: false,
  tag: 'ja',
  filePath: '/package/i18n/ja.json',
  code: 'invalid_json',
  message: 'Invalid JSON in: /package/i18n/ja.json',
  ...overrides,
});

describe('validateSidecars', () => {
  describe('scope gate', () => {
    it('finds nothing and runs no check for a package with no sidecars', () => {
      const check = checkReturning([]);
      expect(validateSidecars({ content, manifest: undefined, sidecars: [] }, [check])).toEqual({
        errors: [],
        messages: [],
      });
      expect(check.run).not.toHaveBeenCalled();
    });

    it('finds nothing in a package whose sidecars satisfy every registered check', () => {
      const sidecars = [sidecarOf('ja', { manifest: { description: 'd' } })];
      expect(validateSidecars({ content, manifest: undefined, sidecars })).toEqual({ errors: [], messages: [] });
    });
  });

  describe('severity routing', () => {
    const error: SidecarFinding = {
      severity: 'error',
      code: 'sidecar_manifest_block_field',
      message: 'i18n/ja.json: bad field',
      path: ['i18n/ja.json', 'manifest', 'id'],
    };
    const warning: SidecarFinding = {
      severity: 'warn',
      code: 'sidecar_stale_translation',
      message: 'i18n/ja.json: stale',
      path: ['i18n/ja.json', 'blocks', 'intro'],
      remediation: 'pathfinder-cli sync-translations <dir>',
    };

    it('routes an error to errors with its code and path', () => {
      const result = validateSidecars({ content, manifest: undefined, sidecars: [sidecarOf('ja')] }, [
        checkReturning([error]),
      ]);
      expect(result.errors).toEqual([{ message: error.message, path: error.path, code: error.code }]);
      expect(result.messages).toEqual([]);
    });

    it('routes a warning to messages as severity warn, with its remediation', () => {
      const result = validateSidecars({ content, manifest: undefined, sidecars: [sidecarOf('ja')] }, [
        checkReturning([warning]),
      ]);
      expect(result.errors).toEqual([]);
      expect(result.messages).toEqual([
        {
          severity: 'warn',
          message: warning.message,
          path: warning.path,
          remediation: 'pathfinder-cli sync-translations <dir>',
          code: 'sidecar_stale_translation',
        },
      ]);
    });

    it('keeps findings in check order', () => {
      const first = checkReturning([{ ...error, message: 'first' }]);
      const second = checkReturning([{ ...error, message: 'second' }]);
      const result = validateSidecars({ content, manifest: undefined, sidecars: [sidecarOf('ja')] }, [first, second]);
      expect(result.errors.map((e) => e.message)).toEqual(['first', 'second']);
    });
  });

  describe('check context', () => {
    it('hands each check the content, manifest, parsed sidecars, projection table and hashes', () => {
      const check = checkReturning([]);
      const manifest = { id: 'guide', type: 'guide' } as const;
      const ja = sidecarOf('ja');
      validateSidecars({ content, manifest, sidecars: [ja] }, [check]);
      const context: SidecarCheckContext = check.run.mock.calls[0][0];
      expect(context.content).toBe(content);
      expect(context.manifest).toBe(manifest);
      expect(context.sidecars).toEqual([ja]);
      expect(Object.keys(context.projection)).toContain('markdown');
      expect(typeof context.hash.block).toBe('function');
    });
  });

  describe('a sidecar that fails to read', () => {
    it.each([
      ['read_error', 'i18n/ja.json cannot be read'],
      ['invalid_json', 'i18n/ja.json is not valid JSON'],
    ] as const)('reports %s as an error with its file path', (code, message) => {
      const result = validateSidecars({ content, manifest: undefined, sidecars: [failure({ code })] }, []);
      expect(result.errors).toEqual([{ message, path: ['i18n/ja.json'], code: 'sidecar_unreadable' }]);
    });

    it('reports each schema issue with its path inside the file', () => {
      const result = validateSidecars(
        {
          content,
          manifest: undefined,
          sidecars: [
            failure({
              code: 'schema_validation',
              issues: [{ code: 'custom', path: ['guide', 'title'], message: 'Invalid input' }],
            }),
          ],
        },
        []
      );
      expect(result.errors).toEqual([
        {
          message: 'i18n/ja.json: Invalid input',
          path: ['i18n/ja.json', 'guide', 'title'],
          code: 'sidecar_unreadable',
        },
      ]);
    });

    it('names the i18n directory when it cannot be listed', () => {
      const result = validateSidecars(
        { content, manifest: undefined, sidecars: [failure({ tag: undefined, code: 'read_error' })] },
        []
      );
      expect(result.errors).toEqual([{ message: 'i18n cannot be read', path: ['i18n'], code: 'sidecar_unreadable' }]);
    });

    it('still runs the checks over the sidecars that did read', () => {
      const check = checkReturning([]);
      const es = sidecarOf('es');
      const result = validateSidecars({ content, manifest: undefined, sidecars: [failure({}), es] }, [check]);
      expect(result.errors).toHaveLength(1);
      expect(check.run.mock.calls[0][0].sidecars).toEqual([es]);
    });

    it('does not leak the absolute path of the file', () => {
      const result = validateSidecars({ content, manifest: undefined, sidecars: [failure({})] }, []);
      expect(JSON.stringify(result)).not.toContain('/package/');
    });
  });
});
