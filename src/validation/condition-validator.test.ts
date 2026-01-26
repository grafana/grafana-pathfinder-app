/**
 * Condition Validator Tests
 *
 * Tests for the condition (requirements/objectives) mini-grammar validator.
 * Includes coupling tests to ensure new condition types get test coverage.
 */

import { FixedRequirementType, ParameterizedRequirementPrefix } from '../types/requirements.types';
import { validateConditionString, validateConditions, validateBlockConditions } from './condition-validator';
import type { JsonGuide } from '../types/json-guide.types';

describe('Condition Validator', () => {
  describe('validateConditionString', () => {
    describe('valid fixed conditions', () => {
      it.each(Object.values(FixedRequirementType))('accepts fixed type: %s', (condition) => {
        const issues = validateConditionString(condition, []);
        expect(issues).toHaveLength(0);
      });
    });

    describe('valid parameterized conditions', () => {
      const validParameterizedConditions: Array<[string, ParameterizedRequirementPrefix]> = [
        ['has-permission:datasources.read', ParameterizedRequirementPrefix.HAS_PERMISSION],
        ['has-role:admin', ParameterizedRequirementPrefix.HAS_ROLE],
        ['has-role:editor', ParameterizedRequirementPrefix.HAS_ROLE],
        ['has-role:viewer', ParameterizedRequirementPrefix.HAS_ROLE],
        ['has-datasource:prometheus', ParameterizedRequirementPrefix.HAS_DATASOURCE],
        ['datasource-configured:loki', ParameterizedRequirementPrefix.DATASOURCE_CONFIGURED],
        ['has-plugin:grafana-clock-panel', ParameterizedRequirementPrefix.HAS_PLUGIN],
        ['plugin-enabled:volkovlabs-rss-datasource', ParameterizedRequirementPrefix.PLUGIN_ENABLED],
        ['has-dashboard-named:My Dashboard', ParameterizedRequirementPrefix.HAS_DASHBOARD_NAMED],
        ['on-page:/dashboards', ParameterizedRequirementPrefix.ON_PAGE],
        ['on-page:/d/abc123', ParameterizedRequirementPrefix.ON_PAGE],
        ['has-feature:alerting', ParameterizedRequirementPrefix.HAS_FEATURE],
        ['in-environment:production', ParameterizedRequirementPrefix.IN_ENVIRONMENT],
        ['min-version:11.0.0', ParameterizedRequirementPrefix.MIN_VERSION],
        ['min-version:9.5.2', ParameterizedRequirementPrefix.MIN_VERSION],
        ['section-completed:setup-datasource', ParameterizedRequirementPrefix.SECTION_COMPLETED],
        ['var-policyAccepted:true', ParameterizedRequirementPrefix.VARIABLE],
        ['var-datasourceName:*', ParameterizedRequirementPrefix.VARIABLE],
        ['var-region:us-east-1', ParameterizedRequirementPrefix.VARIABLE],
        ['renderer:pathfinder', ParameterizedRequirementPrefix.RENDERER],
        ['renderer:website', ParameterizedRequirementPrefix.RENDERER],
      ];

      it.each(validParameterizedConditions)('accepts parameterized: %s', (condition) => {
        const issues = validateConditionString(condition, []);
        expect(issues).toHaveLength(0);
      });
    });

    describe('valid comma-separated conditions', () => {
      it('accepts multiple valid conditions', () => {
        const issues = validateConditionString('is-admin,navmenu-open,exists-reftarget', []);
        expect(issues).toHaveLength(0);
      });

      it('accepts mixed fixed and parameterized conditions', () => {
        const issues = validateConditionString('is-admin,has-datasource:prometheus,on-page:/dashboards', []);
        expect(issues).toHaveLength(0);
      });

      it('handles whitespace gracefully', () => {
        const issues = validateConditionString('is-admin , navmenu-open , exists-reftarget', []);
        expect(issues).toHaveLength(0);
      });

      it('ignores empty components', () => {
        const issues = validateConditionString('is-admin,,navmenu-open', []);
        expect(issues).toHaveLength(0);
      });
    });
  });

  describe('invalid conditions', () => {
    describe('unknown types', () => {
      it('rejects unknown condition type', () => {
        const issues = validateConditionString('foobar', ['test']);
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe('unknown_type');
        expect(issues[0].condition).toBe('foobar');
      });

      it('rejects typos as unknown types', () => {
        const issues = validateConditionString('esists-reftarget', ['test']);
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe('unknown_type');
      });

      it('rejects parameterized prefix without colon as unknown type', () => {
        const issues = validateConditionString('has-datasource', ['test']);
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe('unknown_type');
      });
    });

    describe('unexpected arguments', () => {
      it('rejects fixed type with argument', () => {
        const issues = validateConditionString('is-admin:true', ['test']);
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe('unexpected_argument');
        expect(issues[0].condition).toBe('is-admin:true');
      });

      it('rejects exists-reftarget with argument', () => {
        const issues = validateConditionString('exists-reftarget:selector', ['test']);
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe('unexpected_argument');
      });

      it('rejects navmenu-open with argument', () => {
        const issues = validateConditionString('navmenu-open:docked', ['test']);
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe('unexpected_argument');
      });
    });

    describe('missing arguments', () => {
      it('rejects has-datasource: without argument', () => {
        const issues = validateConditionString('has-datasource:', ['test']);
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe('missing_argument');
        expect(issues[0].condition).toBe('has-datasource:');
      });

      it('rejects on-page: without argument', () => {
        const issues = validateConditionString('on-page:', ['test']);
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe('missing_argument');
      });

      it('rejects min-version: without argument', () => {
        const issues = validateConditionString('min-version:', ['test']);
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe('missing_argument');
      });

      it('rejects has-plugin: without argument', () => {
        const issues = validateConditionString('has-plugin:', ['test']);
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe('missing_argument');
      });
    });

    describe('invalid format', () => {
      it('rejects on-page without leading slash', () => {
        const issues = validateConditionString('on-page:dashboards', ['test']);
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe('invalid_format');
        expect(issues[0].condition).toBe('on-page:dashboards');
      });

      it('rejects min-version with non-semver', () => {
        const issues = validateConditionString('min-version:latest', ['test']);
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe('invalid_format');
      });

      it('rejects min-version with partial version', () => {
        const issues = validateConditionString('min-version:11.0', ['test']);
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe('invalid_format');
      });

      it('rejects has-role with uppercase', () => {
        const issues = validateConditionString('has-role:ADMIN', ['test']);
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe('invalid_format');
        expect(issues[0].condition).toBe('has-role:ADMIN');
      });

      it('rejects renderer with invalid value', () => {
        const issues = validateConditionString('renderer:invalid', ['test']);
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe('invalid_format');
        expect(issues[0].condition).toBe('renderer:invalid');
        expect(issues[0].message).toContain('pathfinder');
        expect(issues[0].message).toContain('website');
      });
    });

    describe('too many components', () => {
      it('rejects more than 10 components', () => {
        const conditions = Array(15).fill('is-admin').join(',');
        const issues = validateConditionString(conditions, ['test']);
        expect(issues.some((i) => i.code === 'too_many_components')).toBe(true);
      });

      it('accepts exactly 10 components', () => {
        const conditions = Array(10).fill('is-admin').join(',');
        const issues = validateConditionString(conditions, ['test']);
        expect(issues.filter((i) => i.code === 'too_many_components')).toHaveLength(0);
      });
    });

    describe('multiple errors in one string', () => {
      it('reports all invalid conditions', () => {
        const issues = validateConditionString('foobar,is-admin:true,has-datasource:', ['test']);
        expect(issues.length).toBe(3);

        const codes = issues.map((i) => i.code);
        expect(codes).toContain('unknown_type');
        expect(codes).toContain('unexpected_argument');
        expect(codes).toContain('missing_argument');
      });
    });
  });

  describe('validateConditions (array)', () => {
    it('validates array of condition strings', () => {
      const issues = validateConditions(['is-admin', 'has-datasource:prometheus'], ['requirements']);
      expect(issues).toHaveLength(0);
    });

    it('reports errors from multiple strings', () => {
      const issues = validateConditions(['foobar', 'has-datasource:'], ['requirements']);
      expect(issues).toHaveLength(2);
    });

    it('handles undefined input', () => {
      const issues = validateConditions(undefined, ['requirements']);
      expect(issues).toHaveLength(0);
    });

    it('handles empty array', () => {
      const issues = validateConditions([], ['requirements']);
      expect(issues).toHaveLength(0);
    });

    it('includes correct path in errors', () => {
      const issues = validateConditions(['foobar'], ['blocks', 2, 'requirements']);
      expect(issues[0].path).toEqual(['blocks', 2, 'requirements', 0]);
    });
  });

  describe('validateBlockConditions', () => {
    it('validates requirements in interactive blocks', () => {
      const guide: JsonGuide = {
        id: 'test',
        title: 'Test',
        blocks: [
          {
            type: 'interactive',
            action: 'button',
            reftarget: '.btn',
            content: 'Click',
            requirements: ['foobar'],
          },
        ],
      };
      const issues = validateBlockConditions(guide);
      expect(issues).toHaveLength(1);
      expect(issues[0].path).toEqual(['blocks', 0, 'requirements', 0]);
    });

    it('validates objectives in interactive blocks', () => {
      const guide: JsonGuide = {
        id: 'test',
        title: 'Test',
        blocks: [
          {
            type: 'interactive',
            action: 'button',
            reftarget: '.btn',
            content: 'Click',
            objectives: ['has-plugin:'],
          },
        ],
      };
      const issues = validateBlockConditions(guide);
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('missing_argument');
    });

    it('validates verify field in interactive blocks', () => {
      const guide: JsonGuide = {
        id: 'test',
        title: 'Test',
        blocks: [
          {
            type: 'interactive',
            action: 'button',
            reftarget: '.btn',
            content: 'Click',
            verify: 'on-page:no-slash',
          },
        ],
      };
      const issues = validateBlockConditions(guide);
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('invalid_format');
    });

    it('validates requirements in steps (multistep)', () => {
      const guide: JsonGuide = {
        id: 'test',
        title: 'Test',
        blocks: [
          {
            type: 'multistep',
            content: 'Multi',
            steps: [
              {
                action: 'button',
                reftarget: '.btn',
                requirements: ['typo-requirement'],
              },
            ],
          },
        ],
      };
      const issues = validateBlockConditions(guide);
      expect(issues).toHaveLength(1);
      expect(issues[0].path).toEqual(['blocks', 0, 'steps', 0, 'requirements', 0]);
    });

    it('validates conditions in nested sections', () => {
      const guide: JsonGuide = {
        id: 'test',
        title: 'Test',
        blocks: [
          {
            type: 'section',
            title: 'Section',
            blocks: [
              {
                type: 'interactive',
                action: 'button',
                reftarget: '.btn',
                content: 'Click',
                requirements: ['bad-requirement'],
              },
            ],
          },
        ],
      };
      const issues = validateBlockConditions(guide);
      expect(issues).toHaveLength(1);
      expect(issues[0].path).toEqual(['blocks', 0, 'blocks', 0, 'requirements', 0]);
    });

    it('validates requirements and objectives on sections', () => {
      const guide: JsonGuide = {
        id: 'test',
        title: 'Test',
        blocks: [
          {
            type: 'section',
            title: 'Section',
            requirements: ['invalid-req'],
            objectives: ['invalid-obj'],
            blocks: [],
          },
        ],
      };
      const issues = validateBlockConditions(guide);
      expect(issues).toHaveLength(2);
    });

    it('returns empty array for valid guide', () => {
      const guide: JsonGuide = {
        id: 'test',
        title: 'Test',
        blocks: [
          {
            type: 'interactive',
            action: 'button',
            reftarget: '.btn',
            content: 'Click',
            requirements: ['is-admin', 'has-datasource:prometheus'],
            objectives: ['has-plugin:my-plugin'],
          },
        ],
      };
      const issues = validateBlockConditions(guide);
      expect(issues).toHaveLength(0);
    });
  });
});

/**
 * COUPLING TESTS
 *
 * These tests ensure that when new condition types are added to requirements.types.ts,
 * the test coverage is updated accordingly. If a new type is added without updating
 * these tests, they will fail.
 */
describe('Condition Types Coverage', () => {
  // All fixed types that should be tested
  const TESTED_FIXED_TYPES = new Set([
    FixedRequirementType.EXISTS_REFTARGET,
    FixedRequirementType.NAVMENU_OPEN,
    FixedRequirementType.HAS_DATASOURCES,
    FixedRequirementType.IS_ADMIN,
    FixedRequirementType.IS_LOGGED_IN,
    FixedRequirementType.IS_EDITOR,
    FixedRequirementType.DASHBOARD_EXISTS,
    FixedRequirementType.FORM_VALID,
  ]);

  // All parameterized prefixes that should be tested
  const TESTED_PARAMETERIZED_PREFIXES = new Set([
    ParameterizedRequirementPrefix.HAS_PERMISSION,
    ParameterizedRequirementPrefix.HAS_ROLE,
    ParameterizedRequirementPrefix.HAS_DATASOURCE,
    ParameterizedRequirementPrefix.DATASOURCE_CONFIGURED,
    ParameterizedRequirementPrefix.HAS_PLUGIN,
    ParameterizedRequirementPrefix.PLUGIN_ENABLED,
    ParameterizedRequirementPrefix.HAS_DASHBOARD_NAMED,
    ParameterizedRequirementPrefix.ON_PAGE,
    ParameterizedRequirementPrefix.HAS_FEATURE,
    ParameterizedRequirementPrefix.IN_ENVIRONMENT,
    ParameterizedRequirementPrefix.MIN_VERSION,
    ParameterizedRequirementPrefix.SECTION_COMPLETED,
    ParameterizedRequirementPrefix.VARIABLE,
    ParameterizedRequirementPrefix.RENDERER,
  ]);

  it('all FixedRequirementType values should be tested', () => {
    const allTypes = new Set(Object.values(FixedRequirementType));
    expect(TESTED_FIXED_TYPES).toEqual(allTypes);
  });

  it('all ParameterizedRequirementPrefix values should be tested', () => {
    const allPrefixes = new Set(Object.values(ParameterizedRequirementPrefix));
    expect(TESTED_PARAMETERIZED_PREFIXES).toEqual(allPrefixes);
  });
});
