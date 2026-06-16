import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../..');

describe('Security lint configuration', () => {
  it('should mechanically enforce F5 DOM sinks', () => {
    const eslintConfig = fs.readFileSync(path.join(REPO_ROOT, 'eslint.config.mjs'), 'utf-8');

    expect(eslintConfig).toContain("AssignmentExpression[left.property.name='innerHTML']");
    expect(eslintConfig).toContain("AssignmentExpression[left.property.value='innerHTML']");
    expect(eslintConfig).toContain("AssignmentExpression[left.property.name='outerHTML']");
    expect(eslintConfig).toContain("AssignmentExpression[left.property.value='outerHTML']");
    expect(eslintConfig).toContain("CallExpression[callee.property.name='insertAdjacentHTML']");
    expect(eslintConfig).toContain("CallExpression[callee.property.value='insertAdjacentHTML']");
    expect(eslintConfig).toContain("AssignmentExpression[left.object.name='script'][left.property.name='src']");
    expect(eslintConfig).toContain("AssignmentExpression[left.object.name='script'][left.property.value='src']");
    expect(eslintConfig).toContain(
      "CallExpression[callee.object.name='document'][callee.property.name='createElement'][arguments.0.value='script']"
    );
  });
});
