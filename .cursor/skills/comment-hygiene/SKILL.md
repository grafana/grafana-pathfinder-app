---
name: comment-hygiene
description: The full QC8 comment-quality catalog — eight bad comment shapes to delete with before/after examples, plus the keep-list of comments that earn their place. Load before writing or editing code comments, or when a review flags comment quality. AGENTS.md carries the one-line rule and the shape titles; this skill carries the worked examples.
---

# Comment hygiene (QC8 catalog)

**Default to no comments.** Add one only when removing it would confuse a reader who can read the surrounding code. The narrow band that earns a comment: counterintuitive code that looks wrong but is correct, hidden invariants, or workarounds for specific external bugs (with a link).

**Trim on touch.** When editing a function, also trim bad-shape comments inside that function and on adjacent declarations in the same file. Do not sweep whole files or grep across the repo for cleanup — comment removal rides along on code changes, never as a standalone PR.

## Bad shapes to avoid and delete

**1. Narrates what the next line obviously does.**

```ts
// Loop over the items and double each one.
items.map((x) => x * 2);
```

The expression already says this.

**2. Defends a non-action (`Intentionally NOT X here because Y`).**

```ts
// Intentionally NOT calling cleanup() here — the parent already handles
// teardown when the dependency changes, and a double-cleanup would race.
doWork();
```

Defends a decision against a future change. When the surrounding architecture shifts, the comment becomes orphaned justification and is one of the most common stale-comment vectors. If the reasoning is load-bearing, put it in the commit message.

**3. References dead process artifacts.**

```ts
/**
 * Critical closure rule (addresses pre-mortem H1, fixes ticket ABC-1234):
 *   The handler reads state inside the listener, not at mount time.
 */
```

Pre-mortem labels, ticket numbers, PR references, and internal pattern names are meaningless six months from now. If the rule matters, document the rule, not the meeting it came from.

**4. Renamed-along-with-symbol (stale-in-waiting).**

```ts
/** From `useFooBar`. Drives visibility of the Reset button. */
hasProgress: boolean;
```

Exists only to point at where a value comes from, which `Find References` does for free. When `useFooBar` gets renamed, the comment becomes a lie unless someone updates it.

**5. Repeats the user-visible string.**

```ts
// Surface a notification so the user understands why nothing happened.
publish({ type: 'alert-info', payload: ['Open a guide before continuing.'] });
```

The alert payload literally says the same thing.

**6. Big JSDoc on a small internal type.**

```ts
/**
 * Structural type for the hook's model parameter. Defined here (not imported)
 * to avoid a circular import. The real model satisfies this shape by virtue
 * of extending SceneObjectBase<State>. <several more lines>
 */
interface HookModel {
  state: State;
  save(): Promise<void>;
}
```

Five-line JSDoc on a three-line internal interface. The cycle-avoidance reason is real but isn't load-bearing for a reader of this file. Compress to one short line or delete.

**7. Justifies a `||` fallback / trivial defaulting.**

```ts
// Prefer currentValue so we land on the latest state, not the initial one.
// For most cases the two are equal.
const value = obj?.currentValue || obj?.initialValue;
```

The `||` already says "fall back." If the names aren't clear enough, rename the fields.

**8. Whole-file docstring on a small (<50 line) module.**

```ts
/**
 * Module-level counter for tracking in-flight requests. Increment when a
 * request starts, decrement when it finishes. <15 more lines of preamble>
 */
let inFlight = 0;
export function begin() {
  inFlight += 1;
}
export function end() {
  if (inFlight > 0) inFlight -= 1;
}
```

Twenty-line preamble on three one-line functions. The header rots faster than the code it sits above. Belongs in a commit message or design doc.

## Keep-list — comments that earn their place

- **Counterintuitive code.** Looks wrong but is correct because of a subtle constraint a reader can't see from the surrounding context.
- **Hidden invariants.** Preconditions or postconditions the type system can't express ("caller must hold the lock," "this must run before X mounts").
- **External-bug workarounds.** Workarounds for specific bugs in dependencies or platform behavior, always with a link to the upstream issue.
- **Security or correctness warnings.** "Do not change this comparison order — see CVE-XXXX-XXXX" with the reason.

If you can't fit the comment in one short line, the code probably needs renaming or restructuring instead of explanation.
