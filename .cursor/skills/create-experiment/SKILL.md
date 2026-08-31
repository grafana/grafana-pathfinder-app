---
name: create-experiment
description: 'Set up a new A/B experiment in Grafana Pathfinder end to end — MTFF flag, variant validation, enrollment seam, exposure and behaviour analytics, QA overrides, tests, docs, and a retirement plan. Use when the user runs `/create-experiment`, asks to add or run an experiment or A/B test, add a treatment/control variant, gate a feature behind an experiment flag, or wire exposure tracking. Also use when reviewing or retiring an existing experiment.'
---

# create-experiment — Set up a Pathfinder A/B experiment

Experiments here are **remote-configured, per-stack, and temporary**. This skill covers the whole lifecycle so an experiment does not leak into the codebase permanently or ship with a broken readout.

Read this whole file before writing code. Several of the constraints below are silent when violated — the experiment still compiles, still renders, and produces numbers that mean nothing.

## Before you start: is this actually an experiment?

| You want to…                                             | Use                                                    |
| -------------------------------------------------------- | ------------------------------------------------------ |
| Compare two behaviours and measure which performs better | An experiment (this skill)                             |
| Turn something on or off remotely, or ship a kill switch | A boolean flag — see `docs/developer/FEATURE_FLAGS.md` |
| Let an operator configure per-instance behaviour         | Plugin `jsonData` admin settings in `src/constants.ts` |

**A boolean flag can never be an experiment.** `reportFeatureFlagExposure` in `src/utils/openfeature-tracking.ts` drops any flag whose `valueType` is not `'object'`, so a boolean experiment flag silently produces zero enrollment events and no readout. This is the single most expensive mistake to make here.

## Hard constraints of the platform

Confirm the experiment design survives all four before writing code. If it does not, say so to the user rather than building something that cannot measure what they asked for.

1. **Allocation is per-stack, not per-user.** `initializeOpenFeature` sets `targetingKey: config.namespace` (`src/utils/openfeature.ts`). Every user on a Grafana stack lands in the same arm, so the readout compares stacks. There is no client-side bucketing in this repo and adding one is a much larger decision — raise it with the user rather than inventing it.
2. **Flags are read once per page load.** The provider is created with `disableVisibilityRefresh: true` and `cacheMode: 'disabled'`. A mid-session flag flip reaches a tab only on its next load.
3. **The `values` array is documentation.** Nothing validates a payload against it at runtime. Your validator is the only protection.
4. **MTFF is Cloud-only.** With no `config.namespace` (OSS, local dev), initialization is skipped and every flag returns its default. Local testing goes through `localStorage` overrides.

## Steps

### 1. Define the flag

Add to `pathfinderFeatureFlags` in `src/utils/openfeature.ts`. This is the one piece that must live outside your experiment directory — the registry is the typed source of `FeatureFlagName`.

```typescript
'pathfinder.<experiment-name>-experiment': {
  valueType: 'object',
  values: EXPERIMENT_VARIANTS.map((variant) => ({ variant })),
  defaultValue: { variant: 'excluded' },
  trackingKey: '<experiment_name>_experiment',
},
```

- Name in kebab-case under the `pathfinder.` prefix (compile-time enforced).
- **Default to `excluded`.** A missing or broken flag must enroll nobody.
- A `trackingKey` is required for exposure events to fire at all.
- Keep `defaultValue` an inline literal so the registry does not import your experiment module — that import direction causes a cycle (see step 3).

Three arms, always: `excluded` (not in the experiment), `control` (in it, current behaviour), `treatment` (in it, new behaviour). `excluded` and `control` must render identically; the difference is only whether the user is counted.

`EXPERIMENT_VARIANTS` in `src/utils/openfeature.ts` is the runtime vocabulary and derives the TypeScript union. Adding an arm also requires an explicit policy in both total projections: `EXPERIMENT_VARIANT_EMITS_EXPOSURE` in `src/utils/openfeature-tracking.ts` and `EXPERIMENT_VARIANT_PRECEDENCE` in `src/lib/analytics.ts`. The compiler should fail until both decisions are made.

### 2. Create the experiment module

Everything else goes in `src/utils/experiments/<experiment-name>.ts` so retirement is a directory delete.

The module owns: the config interface, the runtime default, the validator, the reader, and the enrollment memo.

**Validate the whole payload, reject the whole payload.** Reuse `parseExperimentVariant` and `warnExperimentRejection` from `src/utils/openfeature.ts` — do not hand-roll variant checking. On rejection fall back to `excluded`.

Two rejection sources behave differently, and this trips people up in QA:

| Rejected payload from   | Result                                                           |
| ----------------------- | ---------------------------------------------------------------- |
| MTFF (remote)           | The `excluded` default — nobody is enrolled                      |
| `localStorage` override | The override is **ignored** and the remote value applies instead |

Warnings must carry a low-cardinality classification, never the raw payload — that is a privacy invariant from `docs/developer/TELEMETRY.md`.

### 3. Choose the enrollment seam — the decision that matters most

**Evaluating the flag is what emits the exposure event.** `TrackingHook` is registered at the OpenFeature API level, so wherever the flag is first read is when the user counts as enrolled. This is a design decision, not an implementation detail.

Ask: _what must be true for a user to have had a fair chance to experience the treatment?_ Enroll there.

Two shapes to choose between:

- **Eager (boot).** Read at module scope in `src/module.tsx`. Right when the treatment can affect the very first paint. Enrolls everyone who loads Grafana, including users who never open Pathfinder.
- **Lazy (on panel open).** Memoise behind an `enroll…` function called from the panel-mount effect. Right when the treatment only exists inside Pathfinder — enrolling a user who never opened it would dilute the readout with people who could not have seen it.

For a lazy experiment, expose two functions and keep them distinct:

```typescript
let enrolledConfig: MyConfig | null = null;

// Evaluates — and therefore enrolls. Call only from the chosen seam.
export function enrollMyExperiment(): MyConfig {
  enrolledConfig ??= readConfig();
  return enrolledConfig;
}

// Cache read only. Never evaluates, so it cannot enroll anyone.
export function getEnrolledMyExperimentConfig(): MyConfig | null {
  return enrolledConfig;
}
```

Then add a call-site tripwire: a test that walks `src/` for the `enroll…` symbol and asserts the set of callers matches an explicit allowlist. The timing contract is invisible at the call site — a stray early call silently invalidates the experiment and nothing else in the suite notices.

Remember the panel opens on three surfaces (sidebar, floating, full screen). Decide whether all three enroll, and cover the ones you choose.

### 4. Wire analytics enrichment

Add the arm to the `getActiveExperiments` enrichment reader under `src/utils/experiments/`, dropping `excluded`. This stamps `experiments` and a rolled-up `variant` on every `reportAppInteraction` call and on Faro session cohorts.

**For a lazy experiment, read the cache here, never the evaluator.** This function runs on every analytics event; calling the evaluator would enroll users at whatever the first analytics event happens to be, quietly destroying the timing you chose in step 3.

Faro session attributes are stamped once at `initFaro`, before any lazy enrollment. If the experiment enrolls later, call `stampSessionExperiments()` again at the enrollment seam so the cohort reaches session-scoped Faro queries.

**Do not import `utils/experiments` from `src/lib/telemetry/`.** That edge drags the experiment modules into the telemetry import cycle and `src/validation/architecture.test.ts` will fail. Read cohorts through `getBoundActiveExperiments` in `src/lib/analytics.ts` instead.

### 5. Build the treatment

Put the UI in its own directory (`src/components/<Experiment>/`) and gate it on `variant === 'treatment'`, returning `null` otherwise.

- **Control must be byte-identical to today.** If the control arm renders anything new, the experiment measures the wrong thing.
- Read the arm through `useMemo(() => enrollMyExperiment(), [])` rather than calling it bare in render — evaluation has a side effect and must not run on every render pass.
- UI text goes through `t()` from `@grafana/i18n` in sentence case, then `npm run i18n-extract` and the `i18n-sync` skill for the other locales. Add only your keys; the locale files carry unrelated drift and a full re-extract buries the change.
- If the treatment is dismissible, persist dismissal under a `StorageKeys` entry in `src/lib/storage-keys.ts` and read it synchronously so there is no flash. Dismissal hides the UI — it must not un-enroll the user.

### 6. Add behaviour analytics

Enrollment reuses the existing `pathfinder_feature_flag_evaluated` exposure event — do **not** invent a second enrollment event; the warehouse already consumes that one.

Add `UserInteraction` members in `src/lib/analytics.ts` for the arm's own interactions (impression, the CTA, dismissal, completion). Points to hold:

- Keep attributes low-cardinality literals. New user-derived free-text fields need privacy review.
- The context panel remounts on tab switches, so an impression event needs a module-level once-per-page-load guard or it counts tab switches.
- Prefer one terminal event carrying a step index over per-step events when you want a drop-off funnel.
- No Faro facade op is needed unless the feature has a fallback ladder, a latency budget, or a new surface — see `docs/developer/TELEMETRY.md`. Every `reportAppInteraction` call already mirrors into Faro.

### 7. Make it QA-able

`window.__pathfinderExperiment.setOverride` works for any registered flag automatically. Beyond that:

- Fire `reportFeatureFlagExposure` explicitly on the override branch of your reader — overrides bypass the client, so `TrackingHook` never sees them and QA runs would otherwise produce no analytics.
- For a lazy experiment, add a **getter** to `src/utils/experiments/experiment-debug.ts`, following whichever lazy experiment is current. A captured snapshot would always read as not-enrolled, and a getter that evaluates would enroll the tester by opening DevTools.

### 8. Test

- Arm resolution: each variant, plus rejection cases (unknown variant, missing field, non-object, null, thrown evaluation) all landing on `excluded`.
- Override honoured, and a rejected override falling through to remote.
- Enrichment: arm absent from `getActiveExperiments` when excluded.
- For a lazy experiment: **no evaluation before enrollment**, exactly one evaluation across repeated calls, and `getActiveExperiments` not evaluating. Plus the call-site tripwire from step 3.
- Treatment UI: renders for `treatment`, renders nothing for `control` and `excluded`, and each analytics event fires with the expected payload.

Use `jest.isolateModules` throughout — the enrollment memo is module state, and the tests are precisely about when it is populated. `src/test-utils/openfeature-mock.ts` has `createIsolatedWebSdkMock` / `createIsolatedReactSdkMock` for this.

### 9. Document

- `docs/developer/FEATURE_FLAGS.md` — a section under "Current feature flags": purpose, type, default, variant table, tracking key, and **the enrollment timing** if it is not the boot default.
- `docs/developer/EXPERIMENT_TESTING.md` — add a row to "Current experiments", an override recipe per arm, and any extra storage keys the reset snippet must clear.

### 10. Plan the retirement now

Experiments are temporary; commit `ecefbeaa` retired the previous batch. Write the teardown list into the PR description while it is all still in your head:

- The flag entry in `src/utils/openfeature.ts`
- `src/utils/experiments/<experiment-name>.ts` and its test
- The arm in `getActiveExperiments`, and the tripwire test
- The treatment UI directory
- `UserInteraction` members, `StorageKeys` entries, `testIds` entries, i18n keys
- The doc sections in both files above
- The MTFF flag itself

Leaving a retired arm in the registry means a future operator can re-enroll users into an experiment nobody is reading.

## Traps

- **A boolean flag never emits exposures.** Object-valued with a `variant` field, or no readout.
- **`excluded` is skipped by design.** Only `control` and `treatment` produce exposure events. A missing event for an excluded user is correct, not a bug.
- **Exposure dedup is per `(hostname, flag, variant)` and permanent.** Once fired, it never fires again for that arm on that browser. Use `__pathfinderExperiment.clearExposures()` when re-testing, or you will conclude the event is broken.
- **Variant reassignment re-fires.** The marker key includes the variant, which is what downstream A/B tools expect.
- **A rejected override falls back to remote, not to the default.** Locally that looks like silence; on a Cloud stack you get the remote arm's behaviour instead of the one you asked for.
- **Enrichment must never evaluate.** `getActiveExperiments` runs on every analytics event.
- **`values` validates nothing.** Only your validator does.

## Why this skill names no experiment

Every reference in this file is to permanent infrastructure — the flag registry, the tracking hook, the debug surface, the analytics module. It deliberately cites no specific experiment, because experiments are temporary: step 10 exists to delete them, and a worked example that points at one becomes a broken link the moment it retires.

To find the current shapes, look at what is in `src/utils/experiments/` right now and read the two entry points named above: the module-scope read in `src/module.tsx` for the eager shape, and the panel-mount effect for the lazy one. `docs/developer/FEATURE_FLAGS.md` lists whatever is live.
