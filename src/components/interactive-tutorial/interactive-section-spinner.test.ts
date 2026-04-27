import * as fs from 'fs';
import * as path from 'path';

// Transient test — proves the off-axis spinner bug (#778) before the fix.
// Deleted in the same commit that removes the spinner.
describe('InteractiveSection header spinner (#778)', () => {
  it('should not render an off-axis spinner glyph in the section title container', () => {
    const source = fs.readFileSync(path.join(__dirname, 'interactive-section.tsx'), 'utf8');
    expect(source).not.toContain('interactive-section-spinner');
  });
});
