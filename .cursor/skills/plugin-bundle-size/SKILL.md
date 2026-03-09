---
name: plugin-bundle-size
description: Optimise Grafana app plugin bundle size using React.lazy, Suspense, and webpack code splitting.
  Use when the user asks to reduce plugin bundle size, optimise module.js, add code splitting,
  improve initial plugin load performance, split plugin chunks, lazy load plugin pages, or
  help implement lazy loading in a Grafana app plugin. Triggers on phrases like "optimise plugin
  bundle size", "module.js is too large", "plugin is slow to load", "code split the plugin",
  "reduce initial JS payload", or "help me with Suspense in my plugin".
---

# Grafana plugin bundle size optimisation

`module.js` is the render-blocking entry point for every Grafana app plugin. The smaller it is, the less impact the plugin has on Grafana's overall startup time. A well-split plugin should have a `module.js` under ~200 KB that contains nothing but lazy-loaded wrappers — all feature code loads on demand.

**Target:** ~15–25 JS chunks total. Fewer means too little splitting; far more (50+) means over-engineering.

## Risk levels

Not all splitting opportunities carry the same risk. Apply them in this order:

| Level            | What                                                                 | Risk                               | Impact                                   |
| ---------------- | -------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------- |
| **Safe**         | `module.tsx` lazy wrappers (Priority 1)                              | Very low — no behaviour change     | Highest — module.js drops 90%+           |
| **Safe**         | Route-level `lazy()` (Priority 2)                                    | Low — each route is self-contained | High — one chunk per route               |
| **Safe**         | Extension `lazy()` (Priority 3)                                      | Low — extensions are isolated      | Medium — independent chunk per extension |
| **Moderate**     | Component registries / tab panels (Priority 4)                       | Medium — verify Suspense placement | Medium — splits heavy pages further      |
| **Do not touch** | Vendor libraries (`@grafana/scenes`, `@reduxjs/toolkit`)             | N/A                                | N/A — webpack splits these automatically |
| **Do not touch** | Shared utility components (Markdown, Spinner) used across many files | High churn, many callsites         | Low — already in shared vendor chunks    |

When in doubt, stop after Priority 2. Routes alone typically reduce `module.js` by 95%+.

---

## Step 1: Add bundle size CI reporting (recommended)

Add the `grafana/plugin-actions/bundle-size` action to get automatic bundle size comparison comments on every PR. This posts a table showing entry point size changes, file count diffs, and total bundle impact — making regressions visible before merge.

**Root-level plugins** (plugin at repo root):

```yaml
# .github/workflows/bundle-size.yml
name: Bundle Size
on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  bundle-size:
    runs-on: ubuntu-x64-large
    permissions:
      contents: write
      id-token: write
      pull-requests: write
      actions: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
      - name: Install and build
        run: yarn install
      - name: Bundle Size
        uses: grafana/plugin-actions/bundle-size@a66a1c96cdbb176f9cccf10cf23593e250db7cce # bundle-size/v1.1.0
```

**Subdirectory plugins** (e.g. `plugin/` in a monorepo):

The action's install step runs at the repo root and cannot find `yarn.lock` in a subdirectory. Work around this by installing deps yourself and symlinking to root:

```yaml
# .github/workflows/bundle-size.yml
name: Bundle Size
on:
  pull_request:
    paths: ['plugin/**']
  push:
    branches: [main]
    paths: ['plugin/**']
  workflow_dispatch:

jobs:
  bundle-size:
    runs-on: ubuntu-x64-large
    permissions:
      contents: write
      id-token: write
      pull-requests: write
      actions: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: ./plugin/.nvmrc

      # Auth for private npm registries (if needed)
      # - uses: google-github-actions/auth@v3 ...
      # - run: npx google-artifactregistry-auth ...

      - name: Install dependencies
        working-directory: ./plugin
        run: yarn install

      - name: Symlink plugin to root for bundle-size action
        run: |
          ln -s plugin/yarn.lock yarn.lock
          ln -s plugin/package.json package.json
          ln -s plugin/.yarnrc.yml .yarnrc.yml
          ln -s plugin/node_modules node_modules

      - name: Bundle Size
        uses: grafana/plugin-actions/bundle-size@a66a1c96cdbb176f9cccf10cf23593e250db7cce # bundle-size/v1.1.0
        with:
          working-directory: ./plugin
```

**How it works:**

- On **push to main**: builds and uploads a `main-branch-stats` artifact as baseline
- On **PRs**: builds the PR, downloads the baseline, compares, and posts a comment
- First run on main generates the baseline — use `workflow_dispatch` to trigger manually after adding the workflow
- The `threshold` input (default `5`) controls whether the comment is posted (only when entry point diff exceeds N%)

**Reference:** [grafana-k8s-plugin workflow](https://github.com/grafana/grafana-k8s-plugin/blob/main/.github/workflows/grafana.yml) (root-level), [cloud-onboarding #10388](https://github.com/grafana/cloud-onboarding/pull/10388) (subdirectory)

---

## Step 2: Detect plugin context

```bash
# Confirm this is an app plugin (type: "app" — datasource/panel plugins have different needs)
jq -r '"\(.id) — \(.type)"' src/plugin.json

# Locate the entry point
ls src/module.ts src/module.tsx 2>/dev/null

# Measure the current PRODUCTION bundle size BEFORE making any changes
# Dev builds are unminified and much larger — always measure production
yarn build 2>/dev/null || npm run build
echo "=== module.js ==="
ls -lah dist/module.js
echo "=== all JS chunks ==="
ls -lah dist/*.js | sort -k5 -rh | head -20
echo "=== chunk count ==="
ls dist/*.js | wc -l
```

Record the baseline. A pre-split plugin commonly has a `module.js` of 1–3 MB with no other JS chunks.

---

## Step 3: Check and update create-plugin

The `@grafana/create-plugin` tool controls `.config/webpack/`, `.config/jest/`, and other build scaffolding. Updating it often unlocks faster SWC compilation and better chunk output.

```bash
# Check current version
cat .config/.cprc.json 2>/dev/null || grep '"@grafana/create-plugin"' package.json

# Get the latest version
npm view @grafana/create-plugin version

# Update if outdated
npx @grafana/create-plugin@latest update
```

After updating, review the diff (especially `.config/webpack/webpack.config.ts`) and run a test build before proceeding. If the update introduces breaking changes, fix them first.

> **Custom webpack configs:** If the plugin has a top-level `webpack.config.ts` that `webpack-merge`s the scaffolded base config, review the merge carefully after updating — custom rules or plugins may conflict with new scaffolding.

---

## Step 4: Analyse the codebase — find what to split

Read these files in order of impact. Do **not** start implementing until you have read all of them.

**Entry point:**

```bash
cat src/module.ts 2>/dev/null || cat src/module.tsx
```

Look for: direct (non-lazy) imports of `App`, `ConfigPage`, and any `exposeComponent` / `addComponent` targets.

**Root App component:**

```bash
# Common locations
cat src/App.tsx src/components/App.tsx src/feature/app/components/App.tsx 2>/dev/null | head -80
```

Look for: direct imports of page/route components that should be lazy-loaded.

**Extension registrations:**

```bash
grep -r "exposeComponent\|addComponent\|addLink" src/ --include="*.ts" --include="*.tsx" -n
```

Every component registered here is loaded by _other_ Grafana apps — each should be an independent chunk.

**Component registries:**

```bash
# Arrays of objects that contain React components
grep -rn "component:" src/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" | head -20
```

**Exported side-effect singletons:**

```bash
# Values initialised and exported at module level (e.g. Faro, analytics clients)
grep -n "^export const\|^export let" src/module.ts src/module.tsx 2>/dev/null
# Find all files that import from module.ts — these create circular deps after splitting
grep -rn "from '.*module'" src/ --include="*.ts" --include="*.tsx" | grep -v node_modules
```

Look for: `export const faro = initializeFaro()` or similar. These **must** be extracted to a dedicated file before lazy-loading (see Step 4 Priority 1 note on singletons).

**Heavy synchronous imports:**

```bash
# Libraries that are large and only needed in specific pages
grep -rn "from 'monaco-editor\|@codemirror\|d3\b\|recharts\|chart\.js" \
  src/ --include="*.ts" --include="*.tsx" | grep -v node_modules
```

Now prioritise. A good rule: if a file is imported by `module.ts` directly (even transitively), it ends up in `module.js`. Everything reachable from the lazy boundary is its own chunk.

---

## Step 5: Implement splits — in priority order

> **Named vs default exports:** `React.lazy()` requires the target module to have a `default` export. Most Grafana plugin components use **named exports** — these need a `.then()` re-map:
>
> ```ts
> // Named export (e.g. export function MyComponent)
> const LazyMyComp = lazy(() => import('./MyComponent').then((m) => ({ default: m.MyComponent })));
>
> // Default export — works directly
> const LazyMyComp = lazy(() => import('./MyComponent'));
> ```
>
> When creating new extension or page files, prefer `export default` so the `lazy()` call stays clean. For existing files with named exports, use `.then()`.

### Priority 1: module.tsx (highest impact, always do this first)

If the entry point is `module.ts`, rename it:

```bash
git mv src/module.ts src/module.tsx
```

Make `module.tsx` import **nothing** from feature code except through `lazy()`:

```tsx
// src/module.tsx
import React, { lazy, Suspense } from 'react';
import { AppPlugin, AppRootProps } from '@grafana/data';
import { LoadingPlaceholder } from '@grafana/ui';

// Use `import type` for prop interfaces — this is erased at compile time
// and does NOT pull the component module into the eager bundle
import type { MyExtensionProps } from './extensions/MyExtension';
import type { JsonData } from './features/app/state/slice';

// ── Faro (lazy init — keeps @grafana/faro-react out of module.js) ────────────
let faroInitialized = false;
async function initFaro() {
  if (faroInitialized) {
    return;
  }
  faroInitialized = true;
  const { initializeFaro } = await import('faro');
  initializeFaro();
}

// ── Root page ─────────────────────────────────────────────────────────────────
const LazyApp = lazy(async () => {
  await initFaro();
  return import('./features/app/App').then((m) => ({ default: m.App }));
});

function App(props: AppRootProps<JsonData>) {
  return (
    <Suspense fallback={<LoadingPlaceholder text="" />}>
      <LazyApp {...props} />
    </Suspense>
  );
}

// ── Extension components ──────────────────────────────────────────────────────
const LazyMyExtension = lazy(() => import('./extensions/MyExtension').then((m) => ({ default: m.MyExtension })));

function MyExtension(props: MyExtensionProps) {
  return (
    <Suspense fallback={<LoadingPlaceholder text="" />}>
      <LazyMyExtension {...props} />
    </Suspense>
  );
}

// ── Plugin registration ───────────────────────────────────────────────────────
// Pass the JsonData generic so setRootPage() types match the App wrapper
export const plugin = new AppPlugin<JsonData>().setRootPage(App);

plugin.exposeComponent({
  id: 'my-plugin/my-extension/v1',
  title: 'My Extension',
  component: MyExtension,
});
```

**Key details:**

- **`import type` for props:** Always use `import type` when importing interfaces or types for the lazy wrapper's props. A regular import creates a real module dependency that webpack follows, pulling the component code into the eager bundle and defeating the split.
- **`AppPlugin<JsonData>` generic:** If the original App component uses `AppRootProps<JsonData>` (a custom type for `plugin.json` settings), pass that generic to `AppPlugin<JsonData>()`. Without it, `setRootPage()` expects `AppRootProps<KeyValue<any>>` which won't match.
- **Remove the `ComponentClass` type cast:** If the original `module.ts` used `App as unknown as ComponentClass<AppRootProps>`, remove the cast entirely. The lazy wrapper `function App(props)` is a valid React function component and `setRootPage()` accepts it directly.

**Expected impact:** `module.js` drops from MB range to ~50–200 KB.

---

### Side note: singletons (e.g. Faro) — lazy init, not eager

If `module.ts` has a synchronous Faro init like `export const faro = initializeFaro()`, do **not** keep it as a top-level import in `module.tsx`. That pulls the entire `@grafana/faro-react` library into `module.js`.

Instead, **dynamically import and initialise Faro inside the `lazy()` callback**, before the App import resolves. This moves the Faro library into the App chunk:

```tsx
// src/module.tsx — Faro initialises lazily, before App renders
let faroInitialized = false;
async function initFaro() {
  if (faroInitialized) {
    return;
  }
  faroInitialized = true;
  const { initializeFaro } = await import('faro');
  initializeFaro();
}

const LazyApp = lazy(async () => {
  await initFaro();
  return import('./features/app/App').then((m) => ({ default: m.App }));
});
```

This pattern (from [grafana-collector-app](https://github.com/grafana/grafana-collector-app)) ensures:

1. `@grafana/faro-react` and its deps stay **out of `module.js`** — they load with the App chunk
2. Faro initialises **before** any component renders (it runs inside `lazy()` before the App import resolves)
3. The `faroInitialized` guard prevents double-init if the lazy factory runs again

**If other source files import the Faro instance from `module.ts`** (e.g. `import { faro } from '../module'`), first check:

```bash
grep -rn "from '.*module'" src/ --include="*.ts" --include="*.tsx" | grep -v node_modules
```

If files import from `module.ts`, extract the singleton to a dedicated file before renaming:

1. Move to `src/faro.ts` (or if it's already in a separate file like `src/faro/index.ts`, skip this)
2. Update internal imports from `'*/module'` → `'*/faro'`
3. In `module.tsx`, use the lazy `initFaro()` pattern above instead of importing and re-exporting

---

### Priority 2: Route-based splitting in App.tsx

Replace every direct import of a page component with `lazy()`:

```tsx
// src/components/App.tsx
import React, { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { LoadingPlaceholder } from '@grafana/ui';

// One lazy() per route — each becomes its own JS chunk
const HomePage = lazy(() => import('../pages/Home'));
const SettingsPage = lazy(() => import('../pages/Settings'));
const DetailPage = lazy(() => import('../pages/Detail'));
// ... add one per route

function App(props: AppRootProps) {
  return (
    // A single Suspense at the Routes level is enough — no need for one per route
    <Suspense fallback={<LoadingPlaceholder text="" />}>
      <Routes>
        <Route path="home" element={<HomePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="detail/:id" element={<DetailPage />} />
        <Route path="" element={<HomePage />} />
      </Routes>
    </Suspense>
  );
}

export default App;
```

**Bypass barrel files:** When a component is re-exported through an `index.ts` barrel, target the actual component file in the `import()`, not the barrel. If the barrel re-exports multiple things, importing it pulls them all into the same chunk:

```tsx
// Risky — barrel may re-export other heavy modules into this chunk
const Catalog = lazy(() => import('features/catalog'));

// Better — only pulls in the Catalog component's tree
const Catalog = lazy(() => import('features/catalog/Catalog').then((m) => ({ default: m.Catalog })));
```

### Priority 3: Extension components

Each extension file should `export default` its component so webpack can split it cleanly. If it needs context (e.g. `AppProviders`), include that in the export:

```tsx
// src/extensions/MyExtension.tsx
import React from 'react';
import { AppProviders } from '../components/AppProviders';

function MyExtensionContent(props: MyExtensionProps) {
  return <div>...</div>;
}

// Default export wraps with providers so the lazy consumer in module.tsx stays simple
export default function MyExtension(props: MyExtensionProps) {
  return (
    <AppProviders>
      <MyExtensionContent {...props} />
    </AppProviders>
  );
}
```

**`fallback={null}` for extensions:** Extension components often load quickly; a `<LoadingPlaceholder>` flash is more disruptive than no indicator. Use `fallback={null}` unless the component is genuinely slow:

```tsx
function MyExtension(props: MyExtensionProps) {
  return (
    <Suspense fallback={null}>
      <LazyMyExtension {...props} />
    </Suspense>
  );
}
```

**Surgical split — lazy-load the inner component, not the wrapper:** If the extension wrapper must stay eager in `module.tsx` (e.g. it has complex props setup), lazy-load the heavy component it renders instead of restructuring the entry point:

```tsx
// src/components/Extensions/InstallAlloyHelmExtension.tsx
// The wrapper is still imported eagerly in module.tsx — only the heavy inner component is lazy
import React, { lazy, Suspense } from 'react';
import { LoadingPlaceholder } from '@grafana/ui';

const InstallAlloyHelm = lazy(() => import('components/scenes/Config/ClusterConfig/InstallAlloyHelm'));

export function InstallAlloyHelmExtension() {
  return (
    <Suspense fallback={<LoadingPlaceholder text="" />}>
      <InstallAlloyHelm />
    </Suspense>
  );
}
```

This is the right approach when you can't restructure `module.tsx` but one extension pulls in a disproportionately large component tree.

### Priority 4: Component registries and tab panels (if present)

If you have an array of objects containing React components (e.g. tab panels on a details page), apply lazy loading per entry. This is **moderate risk** — verify a `<Suspense>` boundary exists where the component is rendered.

**Tab panel example** (from cloud-onboarding Source page):

```tsx
// Before — all tab components load upfront even though only one is shown at a time
import { ConfigurationDetails } from './ConfigurationDetails';
import { ConnectorOverview } from './ConnectorOverview';
import { Metrics } from './Metrics';

const tabs = [
  { id: 'overview', component: ConnectorOverview },
  { id: 'config', component: ConfigurationDetails }, // 67+ file tree!
  { id: 'metrics', component: Metrics },
];

// After — each tab component loads only when selected
const ConfigurationDetails = lazy(() =>
  import('./ConfigurationDetails/ConfigurationDetails').then((m) => ({ default: m.ConfigurationDetails }))
);
const ConnectorOverview = lazy(() =>
  import('./ConnectorOverview/ConnectorOverview').then((m) => ({ default: m.ConnectorOverview }))
);
const Metrics = lazy(() => import('./Metrics').then((m) => ({ default: m.Metrics })));

const tabs = [
  { id: 'overview', component: ConnectorOverview },
  { id: 'config', component: ConfigurationDetails },
  { id: 'metrics', component: Metrics },
];
```

**Critical: add a Suspense boundary where the tab content renders:**

```tsx
// In the parent component that renders the active tab
<TabContent>
  <Suspense fallback={<LoadingPlaceholder text="" />}>{ActiveTab && <ActiveTab />}</Suspense>
</TabContent>
```

`React.lazy()` returns a valid component reference that can be stored in arrays and rendered later — no special handling needed in the registry itself. The Suspense boundary just needs to exist somewhere above the render point.

**General component registry example:**

```tsx
const LazyConfigEditor = lazy(() => import('./editors/ConfigEditor'));
const LazyQueryEditor = lazy(() => import('./editors/QueryEditor'));

const panels = [
  {
    id: 'config',
    component: (props: ConfigEditorProps) => (
      <Suspense fallback={<LoadingPlaceholder text="" />}>
        <LazyConfigEditor {...props} />
      </Suspense>
    ),
  },
  {
    id: 'query',
    component: (props: QueryEditorProps) => (
      <Suspense fallback={<LoadingPlaceholder text="" />}>
        <LazyQueryEditor {...props} />
      </Suspense>
    ),
  },
];
```

### Datasource plugins: setConfigEditor, setQueryEditor, and support editors

Datasource plugins (type: `"datasource"`) apply the same pattern to `setConfigEditor()`, `setQueryEditor()`, and the `editor`/`QueryEditor` fields on `VariableSupport` and `AnnotationSupport`. Rename `module.ts` → `module.tsx` and lazy-load all four:

```tsx
// src/module.tsx (datasource plugin)
import React, { Suspense } from 'react';
import { DataSourcePlugin } from '@grafana/data';
import { DataSource, DSOptions } from './datasource';
import { Query } from './types';
import type { KGQueryEditorProps } from './components/QueryEditor';

// Named exports → re-map to default with .then()
const LazyConfigEditor = React.lazy(() =>
  import('./components/ConfigEditor').then((m) => ({ default: m.ConfigEditor }))
);
const LazyQueryEditor = React.lazy(() => import('./components/QueryEditor').then((m) => ({ default: m.QueryEditor })));

function ConfigEditor(props: DataSourcePluginOptionsEditorProps<DSOptions>) {
  return (
    <Suspense fallback={null}>
      <LazyConfigEditor {...props} />
    </Suspense>
  );
}
function QueryEditor(props: KGQueryEditorProps) {
  return (
    <Suspense fallback={null}>
      <LazyQueryEditor {...props} />
    </Suspense>
  );
}

export const plugin = new DataSourcePlugin<DataSource, Query, DSOptions>(DataSource)
  .setConfigEditor(ConfigEditor)
  .setQueryEditor(QueryEditor);
```

For **VariableSupport** and **AnnotationSupport**, rename the `.ts` file to `.tsx` and assign the lazy-wrapped component:

```tsx
// src/datasource/VariableSupport.tsx (renamed from .ts)
import React, { Suspense } from 'react';
import type { VariableQueryEditorProps } from './components/VariableQueryEditor';

const LazyVariableQueryEditor = React.lazy(() =>
  import('./components/VariableQueryEditor').then((m) => ({ default: m.VariableQueryEditor }))
);
function VariableQueryEditorWithSuspense(props: VariableQueryEditorProps) {
  return (
    <Suspense fallback={null}>
      <LazyVariableQueryEditor {...props} />
    </Suspense>
  );
}

export class MyVariableSupport extends CustomVariableSupport<DataSource, MyVariableQuery> {
  editor = VariableQueryEditorWithSuspense;
  // ...
}
```

Same pattern for `AnnotationSupport.QueryEditor`. Use `import type` for props interfaces to avoid pulling the component into the module's eager load.

---

## Step 6: Group related chunks if over-splitting

If the build produces more than ~25 JS files, use webpack magic comments to group related pages into a single chunk:

```tsx
// These two pages land in the same "fleet.js" chunk
const FleetList = lazy(() => import(/* webpackChunkName: "fleet" */ '../pages/FleetList'));
const FleetDetail = lazy(() => import(/* webpackChunkName: "fleet" */ '../pages/FleetDetail'));
```

Use one `webpackChunkName` per logical feature area. Don't group unrelated pages — the point is to load code only when needed.

---

## Step 7: Measure and verify

```bash
yarn build 2>/dev/null || npm run build

echo "=== module.js ==="
ls -lah dist/module.js

echo "=== all JS chunks (largest first) ==="
ls -lah dist/*.js | sort -k5 -rh | head -30

echo "=== chunk count ==="
ls dist/*.js | wc -l
```

**Healthy outcome:**

| Metric               | Target                 |
| -------------------- | ---------------------- |
| `module.js` size     | < 200 KB               |
| Total JS chunk count | 15–25                  |
| Largest single chunk | < 1 MB                 |
| Chunk per route      | ✓ (verify in DevTools) |

If a chunk is unexpectedly large (> 1 MB), check what it imports:

```bash
# Analyse bundle composition (if webpack-bundle-analyzer is available)
npx webpack-bundle-analyzer dist/stats.json 2>/dev/null || \
  yarn build --env production --profile 2>/dev/null
```

---

## Step 8: Test the running plugin

Lazy loading can expose runtime errors that were previously hidden by eager loading.

1. Open the plugin in a Grafana instance (refer to the `deploy-plugin-pr` skill to deploy a test build)
2. Navigate to **every route** in the app — each triggers a new chunk download
3. Check browser **DevTools → Network → JS** tab: confirm lazy chunks load on navigation, not all upfront
4. Check browser **Console** for errors
5. Test any `exposeComponent` extensions from other Grafana apps that use them

---

## Troubleshooting

| Symptom                                                      | Cause                                                                                     | Fix                                                                                                 |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `module.js` barely shrank                                    | Entry point still transitively imports feature code                                       | Read `module.tsx` carefully — any direct import pulls its entire tree in                            |
| Route shows blank page                                       | Component is rendered outside its Suspense boundary                                       | Add `<Suspense>` wrapping in the parent, or move the boundary up                                    |
| Extension crashes                                            | Missing `AppProviders` context                                                            | Wrap the default export in the extension file with `<AppProviders>`                                 |
| Too many chunks (50+)                                        | Every subcomponent split                                                                  | Use `webpackChunkName` to group related pages                                                       |
| `module.js` barely shrank after rename                       | Entry point re-exports a singleton (`faro`, analytics) that pulls in its whole init tree  | Extract singleton to `src/faro.ts`; `module.tsx` re-exports it with `export { faro } from './faro'` |
| Circular dependency warning after split                      | Feature files import from `module.ts` (e.g. `faro`) and module.tsx lazy-imports them back | Extract the exported value to a dedicated file (see singleton note in Step 4)                       |
| Build fails after rename                                     | `swc-loader` or `ts-loader` needs tsx support                                             | Ensure `tsconfig.json` has `"jsx": "react-jsx"` and `"tsx"` in the parser config                    |
| `lazy()` throws "does not provide an export named 'default'" | Component uses a named export, not a default export                                       | Use `.then(m => ({ default: m.ComponentName }))` (see named export note in Step 4)                  |
| Datasource editor blank after split                          | Suspense missing on `VariableSupport.editor` or `AnnotationSupport.QueryEditor`           | Wrap the assigned component with a Suspense boundary (see datasource plugin section)                |
| `React.lazy` not available                                   | Very old React or CommonJS module output                                                  | Requires React ≥ 16.6 and `esModuleInterop: true` in tsconfig                                       |
| Chunks not loading in prod                                   | `output.publicPath` mismatch                                                              | Verify `publicPath` in webpack config matches `public/plugins/<PLUGIN_ID>/`                         |
| ESLint `import/no-unused-modules` error after rename         | `ignoreExports` glob only matches `.ts`, not `.tsx`                                       | Add `'./src/*.tsx'` to `ignoreExports` in eslint config                                             |
| Chunks cache forever after deploy                            | `chunkFilename` missing content hash                                                      | Add `[contenthash]` to `output.chunkFilename` in webpack config                                     |
| `setRootPage()` type error after adding `JsonData` generic   | `AppPlugin` not parameterised                                                             | Use `new AppPlugin<JsonData>()` so `setRootPage()` expects `AppRootProps<JsonData>`                 |
| Dev build sizes are huge (multi-MB)                          | Measuring dev instead of production                                                       | Always clean (`rm -rf dist node_modules/.cache`) and build with `--env production` for measurements |

> **rspack compatibility:** All `React.lazy()` / dynamic import patterns work identically with rspack. `webpackChunkName` magic comments are also supported. If the plugin uses `.config/rspack/`, no changes are needed to the build config.

---

## References

- [grafana-collector-app](https://github.com/grafana/grafana-collector-app) — app plugin reference: 2.7 MB → 100 KB after splitting
- [cloud-onboarding #10380](https://github.com/grafana/cloud-onboarding/pull/10380) — app plugin: 18 MB → 234 KB, route + tab + extension splits
- [grafana-k8s-plugin #1730](https://github.com/grafana/grafana-k8s-plugin/pull/1730) — extension params file pattern + surgical lazy split: ~700 KB → ~100 KB
- [grafana-k8s-plugin #2409](https://github.com/grafana/grafana-k8s-plugin/pull/2409) — surgical lazy inside extension wrapper
- [asserts-app-plugin #2705](https://github.com/grafana/asserts-app-plugin/pull/2705) — datasource plugin: setConfigEditor / setQueryEditor / VariableSupport / AnnotationSupport
- [Web.dev — code splitting with lazy and Suspense](https://web.dev/articles/code-splitting-suspense)
- [SurviveJS — webpack code splitting chapter](https://survivejs.com/books/webpack/building/code-splitting/)
- [webpack magic comments](https://webpack.js.org/api/module-methods/#magic-comments) — `webpackChunkName` for grouping chunks
