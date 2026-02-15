# Architecture principles

These are the established architectural principles for the Grafana Pathfinder project. The design review skill checks designs against these principles. Each principle includes the **review question** it generates -- the question a reviewer should ask when evaluating a design.

This is a living document. Add principles as they emerge from design decisions; remove them if they no longer apply. Each principle should earn its place by being specific to this project's conventions -- generic software engineering wisdom is already in the model's training data.

---

## Layered engine architecture

The system is organized into focused engines with clear responsibilities:

- **Context engine** -- detects what the user is doing in Grafana
- **Interactive engine** -- executes tutorial actions and manages step flow
- **Requirements manager** -- validates preconditions and objectives
- **Other engines as the system evolves**

Each engine owns its domain. Cross-engine communication happens through well-defined interfaces (events, hook return values), not shared mutable state.

**Review question**: Does this design respect engine boundaries, or does it reach across engines to read/mutate state that belongs to another domain?

---

## Hook-based business logic

Business logic lives in React hooks, not in components. Components are thin rendering layers. This keeps logic testable, composable, and reusable.

Pattern: `useXxx` hook owns the logic, component calls the hook and renders.

**Review question**: Does this design put decision-making logic in hooks, or does it embed business logic in component rendering code?

---

## Explicit contracts over implicit assumptions

Prefer declared dependencies, typed interfaces, and formal schema fields over conventions that "just happen to work." When two systems depend on each other, the dependency should be visible in code.

Example from the project: the recommender panel's URL filtering created an implicit location guarantee that guides depended on without declaring. The auto-recovery design explicitly calls this out and introduces `startingLocation` as a formal schema field.

**Review question**: Are there implicit assumptions in this design that should be made explicit? What happens when the implicit contract breaks?

---

## Progressive enhancement and graceful degradation

Features degrade gracefully when dependencies are unavailable. The system should always provide _some_ value rather than failing entirely.

Established patterns:

- External recommender unavailable --> fall back to static recommendations
- Content fetch failure --> error message with retry, not blank screen
- Unknown requirements --> pass with warning (fail-open), not hard block
- Bundle fallbacks for content fetching

**Review question**: What happens when a dependency this design relies on is unavailable, slow, or returns unexpected data? Does the design describe its degradation behavior?

---

## Phased implementation over big-bang delivery

Large features are delivered in phases where each phase delivers independently useful value and has clean boundaries. Phases should be ordered by risk (hardest/most uncertain first when possible) or by dependency (foundation before features that depend on it).

**Review question**: Can this design be delivered incrementally? Are the phase boundaries clean -- could you stop after phase N and still have a working system? Are there hidden cross-phase dependencies?

---

## Schema-driven contracts

Types and schemas are the source of truth for data shapes between layers. JSON guide schemas, manifest schemas, and TypeScript interfaces define the contracts that components program against.

**Review question**: Does this design define its data contracts as schemas/types, or does it leave data shapes implicit? If schemas change, what's the migration path?

---

## Grafana ecosystem alignment

Hew to Grafana conventions and APIs rather than inventing custom patterns. Use Grafana Scenes for state management, `useStyles2` for theming, Grafana UI components, and the plugin extension point system as designed.

**Review question**: Does this design use Grafana's existing infrastructure, or does it build custom alternatives? If custom, is there a compelling reason the Grafana-provided approach doesn't work?

---

## User agency preservation

The system assists but does not override the user. Automated actions should be cancellable. Recovery should be prompted, not forced. Tutorial guidance should help users learn, not do everything for them.

Established patterns:

- Ctrl+C cancellation for section execution
- "Fix this" as a prompt rather than silent correction (for medium-recoverability divergences)
- Auto-detection is opt-in

**Review question**: Does this design respect user intent? Could the system's helpfulness become aggressive or disorienting? Are automated actions reversible or cancellable?

---

## Targeted observability over broad monitoring

DOM observation and event listening are scoped to the minimum necessary. MutationObservers watch specific attributes, not entire subtrees. Event listeners are registered on specific elements, not globally, unless there's a clear reason.

Established patterns:

- Debounced DOM observer (800ms) watching specific attributes
- Selective reactive checking (only eligible, non-completed steps)
- Centralized TimeoutManager to prevent competing timeout mechanisms

**Review question**: Does this design's monitoring approach scale? Could it cause performance problems as the number of guides/steps grows? Is the observation scope as narrow as possible?
