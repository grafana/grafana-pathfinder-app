import { defineConfig } from 'eslint/config';
import baseConfig from './.config/eslint.config.mjs';

export default defineConfig([
  {
    ignores: [
      '**/logs',
      '**/*.log',
      '**/npm-debug.log*',
      '**/yarn-debug.log*',
      '**/yarn-error.log*',
      '**/.pnpm-debug.log*',
      '**/node_modules/',
      '.yarn/cache',
      '.yarn/unplugged',
      '.yarn/build-state.yml',
      '.yarn/install-state.gz',
      '**/.pnp.*',
      '**/pids',
      '**/*.pid',
      '**/*.seed',
      '**/*.pid.lock',
      '**/lib-cov',
      '**/coverage',
      '**/dist/',
      '**/artifacts/',
      '**/work/',
      '**/ci/',
      'test-results/',
      'playwright-report/',
      'blob-report/',
      'playwright/.cache/',
      'playwright/.auth/',
      '**/.idea',
      '**/.eslintcache',
      '**/.DS_Store',
      '**/.hippo',
      '**/temp/',
      '**/plans/',
    ],
  },
  ...baseConfig,

  // Phase 6: Security and architecture lint rules (Epic #603)
  // Mechanically enforce security patterns (F1, F5) and architecture patterns.
  // Test files are excluded — they legitimately use innerHTML for DOM setup/teardown.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.*', '**/*.spec.*'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message:
            'Avoid dangerouslySetInnerHTML — it bypasses React and risks XSS (F1). ' +
            'Use sanitizeDocumentationHTML() with parseHTMLToComponents() instead. ' +
            'If raw HTML injection is truly needed, wrap with sanitizeDocumentationHTML() and add an eslint-disable with justification.',
        },
        {
          selector: "AssignmentExpression[left.property.name='innerHTML']",
          message:
            'Avoid .innerHTML assignment — it bypasses React and risks XSS (F5). ' +
            'Use textContent for plain text, or sanitizeDocumentationHTML() if HTML structure is required.',
        },
        {
          selector: "ClassDeclaration[superClass.name='Component']",
          message:
            'Use function components with hooks instead of class components. ' +
            'Exception: error boundaries require componentDidCatch which has no hook equivalent.',
        },
        {
          selector: "ClassDeclaration[superClass.name='PureComponent']",
          message: 'Use function components with React.memo() instead of PureComponent.',
        },
        {
          selector: "ClassDeclaration[superClass.property.name='Component']",
          message:
            'Use function components with hooks instead of class components. ' +
            'Exception: error boundaries require componentDidCatch which has no hook equivalent.',
        },
        {
          selector: "ClassDeclaration[superClass.property.name='PureComponent']",
          message: 'Use function components with React.memo() instead of PureComponent.',
        },
        {
          selector: "JSXAttribute[name.name='draggable']:not([value.expression.value=false])",
          message:
            'Use @dnd-kit instead of the native HTML5 draggable attribute. ' +
            'See components/block-editor/dnd-helpers.tsx for patterns. ' +
            'draggable={false} to suppress native drag is acceptable.',
        },
      ],
    },
  },
]);
