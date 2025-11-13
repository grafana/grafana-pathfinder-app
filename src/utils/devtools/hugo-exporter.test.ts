/**
 * Tests for Hugo shortcode export utilities
 */

import { exportStepsToHugoShortcodes, dslToHugoShortcode, dslListToHugoShortcodes } from './hugo-exporter';
import type { RecordedStep } from './tutorial-exporter';

describe('Hugo Exporter', () => {
  describe('exportStepsToHugoShortcodes', () => {
    it('should export a single button action', () => {
      const steps: RecordedStep[] = [
        {
          action: 'button',
          selector: 'button[data-testid="save"]',
          description: 'Click the save button',
          isUnique: true,
        },
      ];

      const result = exportStepsToHugoShortcodes(steps, { wrapInSequence: false });

      expect(result).toContain('{{< button');
      expect(result).toContain('reftarget="button[data-testid=\'save\']"');
      expect(result).toContain('requirements="exists-reftarget"');
      expect(result).toContain('Click the save button');
      expect(result).toContain('{{< /button >}}');
    });

    it('should export a formfill action with value', () => {
      const steps: RecordedStep[] = [
        {
          action: 'formfill',
          selector: 'input[name="query"]',
          value: 'prometheus',
          description: 'Enter the query',
          isUnique: true,
        },
      ];

      const result = exportStepsToHugoShortcodes(steps, { wrapInSequence: false });

      expect(result).toContain('{{< formfill');
      expect(result).toContain('reftarget="input[name=\'query\']"');
      expect(result).toContain('targetvalue="prometheus"');
      expect(result).toContain('requirements="exists-reftarget"');
      expect(result).toContain('Enter the query');
      expect(result).toContain('{{< /formfill >}}');
    });

    it('should wrap steps in sequence when requested', () => {
      const steps: RecordedStep[] = [
        {
          action: 'button',
          selector: 'button[data-testid="save"]',
          description: 'Click the save button',
          isUnique: true,
        },
      ];

      const result = exportStepsToHugoShortcodes(steps, {
        wrapInSequence: true,
        sequenceId: 'test-sequence',
        sequenceTitle: 'Test Tutorial',
      });

      expect(result).toContain('## Test Tutorial');
      expect(result).toContain('{{< sequence id="test-sequence" >}}');
      expect(result).toContain('{{< /sequence >}}');
    });

    it('should include comments for non-unique selectors', () => {
      const steps: RecordedStep[] = [
        {
          action: 'button',
          selector: 'button.save',
          description: 'Click the save button',
          isUnique: false,
          matchCount: 3,
        },
      ];

      const result = exportStepsToHugoShortcodes(steps, {
        includeComments: true,
        wrapInSequence: false,
      });

      expect(result).toContain('<!-- Warning: Non-unique selector (3 matches) -->');
      // Verify no indentation
      expect(result).toMatch(/^<!-- Warning:/m);
    });

    it('should handle multiple steps', () => {
      const steps: RecordedStep[] = [
        {
          action: 'highlight',
          selector: 'nav[data-testid="nav-menu"]',
          description: 'Open the navigation menu',
          isUnique: true,
        },
        {
          action: 'button',
          selector: 'button[data-testid="add-panel"]',
          description: 'Click add panel',
          isUnique: true,
        },
        {
          action: 'formfill',
          selector: 'input[name="title"]',
          value: 'My Panel',
          description: 'Enter panel title',
          isUnique: true,
        },
      ];

      const result = exportStepsToHugoShortcodes(steps, { wrapInSequence: false });

      expect(result).toContain('{{< highlight');
      expect(result).toContain('{{< button');
      expect(result).toContain('{{< formfill');
      expect(result).toContain('Open the navigation menu');
      expect(result).toContain('Click add panel');
      expect(result).toContain('Enter panel title');
      // Verify no indentation on shortcodes
      expect(result).toMatch(/^{{< highlight/m);
      expect(result).toMatch(/^{{< button/m);
      expect(result).toMatch(/^{{< formfill/m);
    });
  });

  describe('dslToHugoShortcode', () => {
    it('should convert DSL string to Hugo shortcode', () => {
      const dsl = 'button|button[data-testid="save"]|';
      const result = dslToHugoShortcode(dsl, 'Click the save button');

      expect(result).toContain('{{< button');
      expect(result).toContain('reftarget="button[data-testid=\'save\']"');
      expect(result).toContain('Click the save button');
      expect(result).toContain('{{< /button >}}');
    });

    it('should handle formfill with value', () => {
      const dsl = 'formfill|input[name="query"]|prometheus';
      const result = dslToHugoShortcode(dsl, 'Enter query');

      expect(result).toContain('{{< formfill');
      expect(result).toContain('targetvalue="prometheus"');
      expect(result).toContain('Enter query');
    });

    it('should handle invalid DSL format', () => {
      const dsl = 'invalid';
      const result = dslToHugoShortcode(dsl);

      expect(result).toContain('<!-- Invalid DSL format:');
    });
  });

  describe('dslListToHugoShortcodes', () => {
    it('should convert list of DSL strings', () => {
      const dslList = [
        'highlight|nav[data-testid="nav-menu"]|',
        'button|button[data-testid="add-panel"]|',
        'formfill|input[name="title"]|My Panel',
      ];

      const result = dslListToHugoShortcodes(dslList, { wrapInSequence: false });

      expect(result).toContain('{{< highlight');
      expect(result).toContain('{{< button');
      expect(result).toContain('{{< formfill');
      expect(result).toContain('targetvalue="My Panel"');
    });

    it('should wrap in sequence when requested', () => {
      const dslList = ['button|button[data-testid="save"]|'];

      const result = dslListToHugoShortcodes(dslList, {
        wrapInSequence: true,
        sequenceTitle: 'Test Steps',
      });

      expect(result).toContain('## Test Steps');
      expect(result).toContain('{{< sequence');
      expect(result).toContain('{{< /sequence >}}');
    });
  });

  describe('escaping', () => {
    it('should convert double quotes to single quotes in selector values', () => {
      const steps: RecordedStep[] = [
        {
          action: 'button',
          selector: 'button[aria-label="Click me"]',
          description: 'Click button',
          isUnique: true,
        },
      ];

      const result = exportStepsToHugoShortcodes(steps, { wrapInSequence: false });

      expect(result).toContain('reftarget="button[aria-label=\'Click me\']"');
    });

    it('should escape backslashes in values', () => {
      const steps: RecordedStep[] = [
        {
          action: 'formfill',
          selector: 'input[name="path"]',
          value: 'C:\\Users\\Test',
          description: 'Enter path',
          isUnique: true,
        },
      ];

      const result = exportStepsToHugoShortcodes(steps, { wrapInSequence: false });

      expect(result).toContain('targetvalue="C:\\\\Users\\\\Test"');
    });
  });
});
