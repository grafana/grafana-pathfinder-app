/**
 * Tests for Website Shortcode Export Utilities
 */

import { exportStepsForWebsite, exportSingleStepForWebsite } from './website-exporter';
import type { RecordedStep } from './devtools';

describe('website-exporter', () => {
  describe('exportSingleStepForWebsite', () => {
    it('should export a button action', () => {
      const result = exportSingleStepForWebsite('button', 'button[data-testid="save"]', undefined, 'Click save');

      expect(result).toContain('{{< button');
      expect(result).toContain('reftarget="button[data-testid=\\"save\\"]"');
      expect(result).toContain('Click save');
      expect(result).toContain('{{< /button >}}');
    });

    it('should export a formfill action with value', () => {
      const result = exportSingleStepForWebsite('formfill', 'input[name="query"]', 'prometheus', 'Enter query');

      expect(result).toContain('{{< formfill');
      expect(result).toContain('reftarget="input[name=\\"query\\"]"');
      expect(result).toContain('targetvalue="prometheus"');
      expect(result).toContain('Enter query');
      expect(result).toContain('{{< /formfill >}}');
    });

    it('should export a highlight action', () => {
      const result = exportSingleStepForWebsite('highlight', 'div.panel', undefined, 'Highlight panel');

      expect(result).toContain('{{< highlight');
      expect(result).toContain('reftarget="div.panel"');
      expect(result).toContain('Highlight panel');
      expect(result).toContain('{{< /highlight >}}');
    });

    it('should escape quotes in selector', () => {
      const result = exportSingleStepForWebsite('button', 'button[aria-label="My "Button""]');

      expect(result).toContain('reftarget="button[aria-label=\\"My \\"Button\\"\\"]"');
    });
  });

  describe('exportStepsForWebsite', () => {
    it('should export multiple steps with sequence wrapper', () => {
      const steps: RecordedStep[] = [
        {
          action: 'button',
          selector: 'button[data-testid="add"]',
          description: 'Click add button',
          isUnique: true,
        },
        {
          action: 'formfill',
          selector: 'input[name="name"]',
          value: 'Test Name',
          description: 'Enter name',
          isUnique: true,
        },
        {
          action: 'button',
          selector: 'button[data-testid="save"]',
          description: 'Save the form',
          isUnique: true,
        },
      ];

      const result = exportStepsForWebsite(steps, {
        wrapInSequence: true,
        sequenceId: 'test-sequence',
      });

      expect(result).toContain('{{< sequence id="test-sequence" >}}');
      expect(result).toContain('{{< button');
      expect(result).toContain('{{< formfill');
      expect(result).toContain('targetvalue="Test Name"');
      expect(result).toContain('{{< /sequence >}}');
    });

    it('should export steps without sequence wrapper', () => {
      const steps: RecordedStep[] = [
        {
          action: 'highlight',
          selector: 'div.panel',
          description: 'Highlight the panel',
          isUnique: true,
        },
      ];

      const result = exportStepsForWebsite(steps, { wrapInSequence: false });

      expect(result).not.toContain('{{< sequence');
      expect(result).toContain('{{< highlight');
      expect(result).toContain('{{< /highlight >}}');
    });

    it('should include comments for non-unique selectors', () => {
      const steps: RecordedStep[] = [
        {
          action: 'button',
          selector: 'button',
          description: 'Click button',
          isUnique: false,
          matchCount: 5,
        },
      ];

      const result = exportStepsForWebsite(steps, { includeComments: true });

      expect(result).toContain('<!-- Warning: Non-unique selector (5 matches) -->');
    });

    it('should handle multistep actions', () => {
      const steps: RecordedStep[] = [
        {
          action: 'multistep',
          selector:
            '<li class="interactive" data-targetaction="multistep">\n' +
            '    <span class="interactive" data-targetaction=\'button\' data-reftarget=\'button[id="first"]\'></span>\n' +
            '    <span class="interactive" data-targetaction=\'button\' data-reftarget=\'button[id="second"]\'></span>\n' +
            '    Combined steps\n' +
            '</li>',
          description: 'Perform multiple actions',
          isUnique: true,
        },
      ];

      const result = exportStepsForWebsite(steps, { wrapInSequence: false });

      expect(result).toContain('{{< multistep >}}');
      expect(result).toContain('Perform multiple actions');
      expect(result).toContain('{{< button reftarget="button[id=\\"first\\"]" />}}');
      expect(result).toContain('{{< button reftarget="button[id=\\"second\\"]" />}}');
      expect(result).toContain('{{< /multistep >}}');
    });

    it('should handle empty steps array', () => {
      const result = exportStepsForWebsite([]);

      expect(result).toContain('{{< sequence');
      expect(result).toContain('{{< /sequence >}}');
    });

    it('should handle comment and noop actions without reftarget', () => {
      const steps: RecordedStep[] = [
        {
          action: 'comment',
          selector: '',
          description: 'This is a comment',
          isUnique: true,
        },
        {
          action: 'noop',
          selector: '',
          description: 'No operation',
          isUnique: true,
        },
      ];

      const result = exportStepsForWebsite(steps, { wrapInSequence: false });

      expect(result).toContain('{{< comment >}}');
      expect(result).not.toContain('reftarget');
      expect(result).toContain('This is a comment');
      expect(result).toContain('{{< noop >}}');
      expect(result).toContain('No operation');
    });
  });
});
