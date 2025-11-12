import { extractSelectors, extractSelectorStrings, filterStepsByAction } from './action-recorder.util';
import type { RecordedStep } from './tutorial-exporter';

describe('action-recorder.util', () => {
  const mockSteps: RecordedStep[] = [
    {
      action: 'highlight',
      selector: 'button[data-testid="save"]',
      value: undefined,
      description: 'Click: Save',
      isUnique: true,
      matchCount: 1,
      contextStrategy: undefined,
    },
    {
      action: 'formfill',
      selector: 'input[name="query"]',
      value: 'prometheus',
      description: 'Fill text "query"',
      isUnique: true,
      matchCount: 1,
      contextStrategy: 'parent-context',
    },
    {
      action: 'button',
      selector: 'Cancel',
      value: undefined,
      description: 'Click button: "Cancel"',
      isUnique: false,
      matchCount: 2,
    },
    {
      action: 'highlight',
      selector: 'a[href="/dashboard"]',
      value: undefined,
      description: 'Click: Dashboard',
      isUnique: true,
      matchCount: 1,
    },
  ];

  describe('extractSelectors', () => {
    it('should extract all selector information from steps', () => {
      const result = extractSelectors(mockSteps);

      expect(result).toHaveLength(4);
      expect(result[0]).toEqual({
        selector: 'button[data-testid="save"]',
        action: 'highlight',
        value: undefined,
        description: 'Click: Save',
        isUnique: true,
        matchCount: 1,
        contextStrategy: undefined,
      });
      expect(result[1]).toEqual({
        selector: 'input[name="query"]',
        action: 'formfill',
        value: 'prometheus',
        description: 'Fill text "query"',
        isUnique: true,
        matchCount: 1,
        contextStrategy: 'parent-context',
      });
    });

    it('should handle empty array', () => {
      const result = extractSelectors([]);
      expect(result).toEqual([]);
    });

    it('should preserve all optional fields', () => {
      const stepsWithOptionalFields: RecordedStep[] = [
        {
          action: 'formfill',
          selector: 'input[name="test"]',
          value: 'test-value',
          description: 'Fill text "test"',
          isUnique: false,
          matchCount: 3,
          contextStrategy: 'custom-strategy',
        },
      ];

      const result = extractSelectors(stepsWithOptionalFields);
      expect(result[0].isUnique).toBe(false);
      expect(result[0].matchCount).toBe(3);
      expect(result[0].contextStrategy).toBe('custom-strategy');
    });

    it('should handle steps with missing optional fields', () => {
      const stepsMinimal: RecordedStep[] = [
        {
          action: 'highlight',
          selector: 'button',
          description: 'Click: Button',
        },
      ];

      const result = extractSelectors(stepsMinimal);
      expect(result[0]).toEqual({
        selector: 'button',
        action: 'highlight',
        value: undefined,
        description: 'Click: Button',
        isUnique: undefined,
        matchCount: undefined,
        contextStrategy: undefined,
      });
    });
  });

  describe('extractSelectorStrings', () => {
    it('should extract only selector strings', () => {
      const result = extractSelectorStrings(mockSteps);

      expect(result).toEqual(['button[data-testid="save"]', 'input[name="query"]', 'Cancel', 'a[href="/dashboard"]']);
    });

    it('should handle empty array', () => {
      const result = extractSelectorStrings([]);
      expect(result).toEqual([]);
    });

    it('should return array of strings only', () => {
      const result = extractSelectorStrings(mockSteps);
      result.forEach((selector) => {
        expect(typeof selector).toBe('string');
      });
    });
  });

  describe('filterStepsByAction', () => {
    it('should filter steps by action type', () => {
      const result = filterStepsByAction(mockSteps, 'highlight');

      expect(result).toHaveLength(2);
      expect(result[0].action).toBe('highlight');
      expect(result[1].action).toBe('highlight');
      expect(result[0].selector).toBe('button[data-testid="save"]');
      expect(result[1].selector).toBe('a[href="/dashboard"]');
    });

    it('should filter formfill actions', () => {
      const result = filterStepsByAction(mockSteps, 'formfill');

      expect(result).toHaveLength(1);
      expect(result[0].action).toBe('formfill');
      expect(result[0].selector).toBe('input[name="query"]');
      expect(result[0].value).toBe('prometheus');
    });

    it('should filter button actions', () => {
      const result = filterStepsByAction(mockSteps, 'button');

      expect(result).toHaveLength(1);
      expect(result[0].action).toBe('button');
      expect(result[0].selector).toBe('Cancel');
    });

    it('should return empty array when no steps match', () => {
      const result = filterStepsByAction(mockSteps, 'navigate');
      expect(result).toEqual([]);
    });

    it('should handle empty array', () => {
      const result = filterStepsByAction([], 'highlight');
      expect(result).toEqual([]);
    });

    it('should preserve all step properties in filtered results', () => {
      const result = filterStepsByAction(mockSteps, 'formfill');

      expect(result[0]).toHaveProperty('action');
      expect(result[0]).toHaveProperty('selector');
      expect(result[0]).toHaveProperty('value');
      expect(result[0]).toHaveProperty('description');
      expect(result[0]).toHaveProperty('isUnique');
      expect(result[0]).toHaveProperty('matchCount');
      expect(result[0]).toHaveProperty('contextStrategy');
    });
  });
});

